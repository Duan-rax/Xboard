<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('v2_traffic_audit_events', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('event_id', 64)->unique();
            $table->string('connection_id', 128)->nullable();
            $table->string('event_type', 16)->default('rule');
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('node_id', 128)->nullable();
            $table->string('client_source', 255)->nullable();
            $table->timestamp('occurred_at');
            $table->string('action', 32);
            $table->string('route_tag', 128)->nullable();
            $table->unsignedBigInteger('route_id')->nullable();
            $table->string('route_source', 16)->nullable();
            $table->string('outbound', 128)->nullable();
            $table->string('destination', 255)->nullable();
            $table->string('destination_ip', 45)->nullable();
            $table->string('network', 16)->nullable();
            $table->string('protocol', 32)->nullable();
            $table->string('source_ip', 45)->nullable();
            $table->unsignedBigInteger('upload_bytes')->default(0);
            $table->unsignedBigInteger('download_bytes')->default(0);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['connection_id', 'occurred_at']);
            $table->index(['user_id', 'occurred_at']);
            $table->index(['node_id', 'occurred_at']);
            $table->index(['route_id', 'occurred_at']);
            $table->index(['route_tag', 'occurred_at']);
            $table->index(['action', 'occurred_at']);
            $table->index(['destination', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('v2_traffic_audit_events');
    }
};
