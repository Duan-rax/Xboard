<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('v2_server_route', function (Blueprint $table) {
            $table->json('criteria')->nullable()->after('match');
            $table->string('match_mode', 8)->default('any')->after('criteria');
            $table->unsignedInteger('priority')->default(100)->after('match_mode')->index();
            $table->boolean('enabled')->default(true)->after('priority')->index();
        });
    }

    public function down(): void
    {
        Schema::table('v2_server_route', function (Blueprint $table) {
            $table->dropIndex(['priority']);
            $table->dropIndex(['enabled']);
            $table->dropColumn(['criteria', 'match_mode', 'priority', 'enabled']);
        });
    }
};
