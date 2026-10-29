<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('v2_egress_proxy', function (Blueprint $table) {
            $table->id();
            $table->string('name', 128);
            // Generic endpoint types. Protocol-specific options belong in config.
            $table->string('protocol', 16); // socks5, http, shadowsocks, vless, trojan
            $table->string('host', 255);
            $table->unsignedInteger('port');
            $table->text('username')->nullable();
            $table->text('password')->nullable();
            $table->boolean('tls_enabled')->default(false);
            $table->string('tls_server_name', 255)->nullable();
            $table->boolean('allow_insecure')->default(false);
            $table->json('config')->nullable();
            $table->boolean('enabled')->default(true);
            $table->timestamps();
        });

        Schema::table('v2_server', function (Blueprint $table) {
            $table->unsignedBigInteger('egress_proxy_id')->nullable()->after('machine_id')->index();
        });
    }

    public function down(): void
    {
        Schema::table('v2_server', function (Blueprint $table) {
            $table->dropColumn('egress_proxy_id');
        });
        Schema::dropIfExists('v2_egress_proxy');
    }
};
