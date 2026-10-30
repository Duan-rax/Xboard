<?php

namespace App\Http\Routes\V1;

use App\Http\Controllers\V1\TrafficAuditIngestController;
use Illuminate\Contracts\Routing\Registrar;

class TrafficAuditRoute
{
    public function map(Registrar $router): void
    {
        $router->group([
            'prefix' => 'traffic-audit',
            'middleware' => 'throttle:6000,1',
        ], function (Registrar $route): void {
            $route->post('events', [TrafficAuditIngestController::class, 'store']);
        });
    }
}
