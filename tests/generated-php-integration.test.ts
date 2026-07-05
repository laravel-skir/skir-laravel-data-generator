import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { generateLaravelDataFiles } from "../src/generator.js";

describe("generated PHP", () => {
  it("round-trips dense JSON through laravel-skir/runtime", () => {
    const projectPath = join(tmpdir(), "skir-laravel-data-generator-fixture");
    const sourcePath = join(projectPath, "src");
    const runtimePath = process.env.SKIR_RUNTIME_PATH ?? resolve("../runtime");

    rmSync(sourcePath, { recursive: true, force: true });
    mkdirSync(sourcePath, { recursive: true });

    writeFileSync(
      join(projectPath, "composer.json"),
      JSON.stringify(
        {
          repositories: [
            {
              type: "path",
              url: runtimePath,
              options: {
                symlink: false,
              },
            },
          ],
          require: {
            php: "^8.3",
            "illuminate/config": "^10.0|^11.0|^12.0|^13.0",
            "illuminate/translation": "^10.0|^11.0|^12.0|^13.0",
            "illuminate/validation": "^10.0|^11.0|^12.0|^13.0",
            "laravel-skir/runtime": "*",
            "phpoption/phpoption": "^1.9",
            "spatie/laravel-data": "^4.0",
            "vlucas/phpdotenv": "^5.6",
          },
          autoload: {
            "psr-4": {
              "App\\Skir\\": "src/",
            },
          },
          config: {
            "sort-packages": true,
          },
          "minimum-stability": "dev",
          "prefer-stable": true,
        },
        null,
        2,
      ),
    );

    const files = generateLaravelDataFiles({
      config: {
        namespace: "App\\Skir",
      },
      modules: [
        {
          path: "fixtures.skir",
          records: [
            {
              kind: "struct",
              name: "Address",
              fields: [
                { kind: "field", name: "city", number: 0, type: { kind: "string" } },
                { kind: "field", name: "postal_codes", number: 1, type: { kind: "array", item: { kind: "primitive", primitive: "string" } } },
              ],
            },
            {
              kind: "struct",
              name: "HealthCheckRequest",
              fields: [],
            },
            {
              kind: "struct",
              name: "User",
              fields: [
                { kind: "field", name: "user_id", number: 0, type: { kind: "int32" } },
                { kind: "removed", number: 1 },
                { kind: "field", name: "name", number: 2, type: { kind: "string" } },
                { kind: "field", name: "address", number: 3, type: { kind: "record", name: "Address" } },
                { kind: "field", name: "tags", number: 4, type: { kind: "array", item: { kind: "primitive", primitive: "string" } } },
                { kind: "field", name: "nickname", number: 5, type: { kind: "optional", other: { kind: "primitive", primitive: "string" } } },
                { kind: "field", name: "previous_addresses", number: 6, type: { kind: "array", item: { kind: "record", name: "Address" } } },
                { kind: "field", name: "subscription_status", number: 7, type: { kind: "record", name: "SubscriptionStatus", recordType: "enum" } },
                { kind: "field", name: "status_history", number: 8, type: { kind: "array", item: { kind: "record", name: "SubscriptionStatus", recordType: "enum" } } },
              ],
            },
            {
              recordType: "enum",
              name: "SubscriptionStatus",
              fields: [
                { kind: "field", name: "free", number: 1 },
                { kind: "field", name: "premium_since", number: 2, type: { kind: "timestamp" } },
              ],
            },
          ],
          methods: [
            {
              kind: "method",
              name: "GetUser",
              number: 3180856469,
              requestType: { kind: "record", name: "User" },
              responseType: { kind: "record", name: "User" },
            },
          ],
        },
      ],
    });

    for (const file of files) {
      const filePath = join(sourcePath, file.path);

      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.code);
      execFileSync("php", ["-l", filePath], { stdio: "pipe" });
    }

    writeFileSync(
      join(projectPath, "verify.php"),
      `<?php

declare(strict_types=1);

require __DIR__.'/vendor/autoload.php';

use Illuminate\\Config\\Repository;
use Illuminate\\Container\\Container;
use Illuminate\\Support\\Facades\\Facade;
use Illuminate\\Translation\\ArrayLoader;
use Illuminate\\Translation\\Translator;
use Illuminate\\Validation\\Factory as ValidatorFactory;

if (! function_exists('app')) {
    function app(?string $abstract = null, array $parameters = []): mixed
    {
        $container = Container::getInstance();

        if ($abstract === null) {
            return $container;
        }

        return $container->make($abstract, $parameters);
    }
}

if (! function_exists('config')) {
    function config(string|array|null $key = null, mixed $default = null): mixed
    {
        $repository = Container::getInstance()->make('config');

        if ($key === null) {
            return $repository;
        }

        if (is_array($key)) {
            foreach ($key as $name => $value) {
                $repository->set($name, $value);
            }

            return null;
        }

        return $repository->get($key, $default);
    }
}

if (! function_exists('base_path')) {
    function base_path(string $path = ''): string
    {
        return __DIR__.($path === '' ? '' : "/{$path}");
    }
}

if (! function_exists('app_path')) {
    function app_path(string $path = ''): string
    {
        return base_path('app'.($path === '' ? '' : "/{$path}"));
    }
}

if (! function_exists('storage_path')) {
    function storage_path(string $path = ''): string
    {
        return base_path('storage'.($path === '' ? '' : "/{$path}"));
    }
}

$container = new Container();
Container::setInstance($container);
Facade::setFacadeApplication($container);

$container->instance('config', new Repository([
    'data' => require __DIR__.'/vendor/spatie/laravel-data/config/data.php',
]));

$translator = new Translator(new ArrayLoader(), 'en');
$validator = new ValidatorFactory($translator, $container);

$container->instance('validator', $validator);
$container->alias('validator', \\Illuminate\\Contracts\\Validation\\Factory::class);

use App\\Skir\\SubscriptionStatusData;
use App\\Skir\\SkirMethods;
use App\\Skir\\AddressData;
use App\\Skir\\HealthCheckRequestData;
use App\\Skir\\UserData;

$healthCheckRequest = new HealthCheckRequestData();

if ($healthCheckRequest->toSkirJson() !== '[]') {
    throw new RuntimeException('Unexpected health check dense JSON: '.$healthCheckRequest->toSkirJson());
}

$user = new UserData(
    userId: 400,
    name: 'John Doe',
    address: new AddressData(city: 'Antwerp', postalCodes: ['2000', '2018']),
    tags: ['admin', 'beta'],
    nickname: 'johnny',
    previousAddresses: [
        new AddressData(city: 'Brussels', postalCodes: ['1000']),
        new AddressData(city: 'Ghent', postalCodes: ['9000']),
    ],
    subscriptionStatus: SubscriptionStatusData::premiumSince(1743682787000),
    statusHistory: [
        SubscriptionStatusData::free(),
        SubscriptionStatusData::premiumSince(1743682787000),
    ],
);

if ($user->toSkirJson() !== '[400,0,"John Doe",["Antwerp",["2000","2018"]],["admin","beta"],"johnny",[["Brussels",["1000"]],["Ghent",["9000"]]],[2,1743682787000],[1,[2,1743682787000]]]') {
    throw new RuntimeException('Unexpected user dense JSON: '.$user->toSkirJson());
}

$decodedUser = UserData::fromSkir('[400,0,"John Doe",["Antwerp",["2000","2018"]],["admin","beta"],"johnny",[["Brussels",["1000"]],["Ghent",["9000"]]],[2,1743682787000],[1,[2,1743682787000]]]');

if ($decodedUser->userId !== 400 || $decodedUser->name !== 'John Doe') {
    throw new RuntimeException('Unexpected decoded user.');
}

if (! $decodedUser->address instanceof AddressData || $decodedUser->address->city !== 'Antwerp') {
    throw new RuntimeException('Unexpected decoded address.');
}

if ($decodedUser->tags !== ['admin', 'beta'] || $decodedUser->nickname !== 'johnny') {
    throw new RuntimeException('Unexpected decoded array or optional field.');
}

if (count($decodedUser->previousAddresses) !== 2 || ! $decodedUser->previousAddresses[0] instanceof AddressData) {
    throw new RuntimeException('Unexpected decoded record array.');
}

if ($decodedUser->subscriptionStatus->name() !== 'premium_since' || $decodedUser->subscriptionStatus->payload() !== 1743682787000) {
    throw new RuntimeException('Unexpected decoded enum field.');
}

if (count($decodedUser->statusHistory) !== 2 || $decodedUser->statusHistory[0]->name() !== 'free') {
    throw new RuntimeException('Unexpected decoded enum array.');
}

$status = SubscriptionStatusData::premiumSince(1743682787000);

if ($status->toDenseJson() !== '[2,1743682787000]') {
    throw new RuntimeException('Unexpected status dense JSON: '.$status->toDenseJson());
}

$decodedStatus = SubscriptionStatusData::fromDenseJson('[2,1743682787000]');

if ($decodedStatus->name() !== 'premium_since' || $decodedStatus->payload() !== 1743682787000) {
    throw new RuntimeException('Unexpected decoded status.');
}

$method = SkirMethods::getUser();

if ($method->name !== 'GetUser' || $method->number !== 3180856469) {
    throw new RuntimeException('Unexpected method descriptor.');
}
`,
    );

    if (! existsSync(join(projectPath, "vendor", "autoload.php"))) {
      execFileSync("composer", ["install", "--no-interaction", "--no-progress"], {
        cwd: projectPath,
        stdio: "pipe",
      });
    }

    execFileSync("php", ["verify.php"], {
      cwd: projectPath,
      stdio: "inherit",
    });

    expect(files.map((file) => file.path).sort()).toEqual(["AddressData.php", "HealthCheckRequestData.php", "SkirMethods.php", "SubscriptionStatusData.php", "UserData.php"]);
  }, 180_000);
});
