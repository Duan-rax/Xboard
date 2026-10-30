<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TrafficAuditEvent extends Model
{
    protected $table = 'v2_traffic_audit_events';
    protected $guarded = ['id'];
    protected $casts = [
        'user_id' => 'integer',
        'route_id' => 'integer',
        'occurred_at' => 'datetime',
        'upload_bytes' => 'integer',
        'download_bytes' => 'integer',
        'metadata' => 'array',
    ];
}
