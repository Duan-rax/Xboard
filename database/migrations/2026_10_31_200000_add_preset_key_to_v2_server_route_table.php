<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('v2_server_route', function (Blueprint $table): void {
            $table->string('preset_key', 64)->nullable()->after('remarks')->index();
        });
    }

    public function down(): void
    {
        Schema::table('v2_server_route', function (Blueprint $table): void {
            $table->dropIndex(['preset_key']);
            $table->dropColumn('preset_key');
        });
    }
};
