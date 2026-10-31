<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('v2_server_egress_binding', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('server_id');
            $table->unsignedBigInteger('egress_proxy_id');
            $table->boolean('is_default')->default(false);
            $table->timestamps();
            $table->unique(['server_id', 'egress_proxy_id'], 'server_egress_unique');
            $table->index(['egress_proxy_id', 'is_default'], 'egress_default_lookup');
        });

        DB::table('v2_server')
            ->whereNotNull('egress_proxy_id')
            ->where('egress_proxy_id', '>', 0)
            ->orderBy('id')
            ->chunkById(500, function ($servers): void {
                $now = now();
                $rows = [];
                foreach ($servers as $server) {
                    $rows[] = [
                        'server_id' => (int) $server->id,
                        'egress_proxy_id' => (int) $server->egress_proxy_id,
                        'is_default' => true,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }
                if ($rows !== []) {
                    DB::table('v2_server_egress_binding')->insertOrIgnore($rows);
                }
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('v2_server_egress_binding');
    }
};
