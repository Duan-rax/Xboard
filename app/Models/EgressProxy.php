<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
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

    public function servers(): BelongsToMany
    {
        return $this->belongsToMany(
            Server::class,
            'v2_server_egress_binding',
            'egress_proxy_id',
            'server_id'
        )->withPivot('is_default')->withTimestamps();
    }

    public function defaultServers(): HasMany
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

    public static function managedIdFromTag(string $tag): int
    {
        if (preg_match('/^panel-egress-(\d+)$/', trim($tag), $matches) !== 1) {
            return 0;
        }
        return (int) $matches[1];
    }

    public static function managedTag(int $id): string
    {
        return 'panel-egress-' . $id;
    }
}
