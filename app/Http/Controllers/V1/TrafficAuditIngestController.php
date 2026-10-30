<?php

namespace App\Http\Controllers\V1;

use App\Http\Controllers\Controller;
use App\Services\TrafficAudit\TrafficAuditService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TrafficAuditIngestController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $secret = TrafficAuditService::webhookSecret();
        if ($secret === '') {
            return response()->json(['message' => 'Traffic audit webhook secret is not configured'], 503);
        }

        $timestamp = $request->header('X-Audit-Timestamp');
        $signature = $request->header('X-Audit-Signature');
        if (is_string($timestamp) || is_string($signature)) {
            $maxSkew = max(30, (int) admin_setting('traffic_audit_clock_skew', 300));
            if (!is_string($timestamp) || !ctype_digit($timestamp) || abs(time() - (int) $timestamp) > $maxSkew) {
                return response()->json(['message' => 'Invalid or expired audit timestamp'], 401);
            }
            if (!is_string($signature) || !preg_match('/^[a-f0-9]{64}$/i', $signature)) {
                return response()->json(['message' => 'Invalid audit signature'], 401);
            }
            $expected = hash_hmac('sha256', $timestamp . '.' . $request->getContent(), $secret);
            if (!hash_equals($expected, $signature)) {
                return response()->json(['message' => 'Invalid audit signature'], 401);
            }
        } elseif (!hash_equals($secret, (string) $request->header('X-Audit-Token', ''))) {
            return response()->json(['message' => 'Invalid audit token'], 401);
        }

        $this->normaliseXrayWebhook($request);
        $data = $request->validate([
            'event_id' => ['required', 'string', 'max:64', 'regex:/^[A-Za-z0-9_-]+$/'],
            'connection_id' => ['nullable', 'string', 'max:128'],
            'event_type' => ['nullable', 'in:start,delta,close,rule'],
            'user_id' => ['nullable', 'integer', 'min:1'],
            'node_id' => ['nullable', 'string', 'max:128'],
            'client_source' => ['nullable', 'string', 'max:255'],
            'occurred_at' => ['nullable', 'date'],
            'action' => ['required', 'string', 'max:32'],
            'rule_tag' => ['nullable', 'string', 'max:128'],
            'route_tag' => ['nullable', 'string', 'max:128'],
            'route_id' => ['nullable', 'integer', 'min:1'],
            'route_source' => ['nullable', 'in:kernel,collector,manual'],
            'outbound' => ['nullable', 'string', 'max:128'],
            'destination' => ['nullable', 'string', 'max:255'],
            'destination_ip' => ['nullable', 'ip'],
            'network' => ['nullable', 'string', 'max:16'],
            'upload_bytes' => ['nullable', 'integer', 'min:0'],
            'download_bytes' => ['nullable', 'integer', 'min:0'],
            'protocol' => ['nullable', 'string', 'max:32'],
            'metadata' => ['nullable', 'array'],
        ]);

        $result = TrafficAuditService::insertEvent($data, $request->ip());
        return response()->json(['data' => $result], $result['duplicate'] ? 200 : 201);
    }

    private function normaliseXrayWebhook(Request $request): void
    {
        $payload = $request->all();
        if (isset($payload['event_id']) || !isset($payload['destination'])) {
            return;
        }

        $email = (string) ($payload['email'] ?? '');
        $userId = preg_match('/(?:^|@)([1-9][0-9]*)$/', $email, $matches)
            ? (int) $matches[1]
            : null;
        $occurredAt = isset($payload['ts']) && is_numeric($payload['ts'])
            ? CarbonImmutable::createFromTimestampUTC((int) $payload['ts'])->toIso8601String()
            : now()->utc()->toIso8601String();
        $hash = hash('sha256', $request->getContent());

        $request->replace([
            'event_id' => 'xray-' . $hash,
            'connection_id' => 'xray-' . $hash,
            'event_type' => 'rule',
            'user_id' => $userId,
            'node_id' => $request->header('X-Audit-Node'),
            'occurred_at' => $occurredAt,
            'action' => (string) ($payload['outboundTag'] ?? 'observe'),
            'rule_tag' => $request->header('X-Audit-Rule'),
            'outbound' => $payload['outboundTag'] ?? null,
            'destination' => (string) $payload['destination'],
            'client_source' => $payload['source'] ?? null,
            'network' => $payload['network'] ?? null,
            'protocol' => $payload['protocol'] ?? null,
            'metadata' => [
                'kernel' => 'xray',
                'inbound_tag' => $payload['inboundTag'] ?? null,
                'inbound_name' => $payload['inboundName'] ?? null,
                'original_target' => $payload['originalTarget'] ?? null,
            ],
        ]);
    }
}
