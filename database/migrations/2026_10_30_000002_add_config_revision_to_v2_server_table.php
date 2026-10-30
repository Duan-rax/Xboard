<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('v2_server', function (Blueprint $table) {
            $table->unsignedBigInteger('config_revision')
                ->default(0)
                ->after('egress_proxy_id')
                ->index();
        });
    }

    public function down(): void
    {
        Schema::table('v2_server', function (Blueprint $table) {
            $table->dropIndex(['config_revision']);
            $table->dropColumn('config_revision');
        });
    }
};
