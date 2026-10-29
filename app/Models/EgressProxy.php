<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An administrator-managed egress endpoint. Credentials are encrypted at rest
 * and are sent only to an authenticated node when it requests its config.
 */
class EgressProxy extends Model
{
    protected $table = 'v2_egress_proxy';

    protected $guarded = ['id', 'created_at', 'updated_at'];

    protected $casts = [
        'username' => 'encrypted',
        'password' => 'encrypted',
        'tls_enabled' => 'boolean',
        'allow_insecure' => 'boolean',
        'enabled' => 'boolean',
        'config' => 'array',
    ];

    public function servers(): HasMany
    {
        return $this->hasMany(Server::class, 'egress_proxy_id');
    }

    /** Data safe for the node control-plane response, never for subscriptions. */
    public function toNodeConfig(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'protocol' => $this->protocol,
            'host' => $this->host,
            'port' => (int) $this->port,
            'username' => $this->username,
            'password' => $this->password,
            'tls_enabled' => $this->tls_enabled,
            'tls_server_name' => $this->tls_server_name,
            'allow_insecure' => $this->allow_insecure,
            'config' => $this->config ?? [],
        ];
    }
}
