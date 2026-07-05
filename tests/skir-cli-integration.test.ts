import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

describe("skir CLI integration", () => {
  it("generates executable PHP from a real .skir fixture", () => {
    const projectPath = join(tmpdir(), "skir-laravel-data-generator-cli-fixture");
    const skirSourcePath = join(projectPath, "skir-src");
    const adminSkirSourcePath = join(skirSourcePath, "admin");
    const commonSkirSourcePath = join(skirSourcePath, "common");
    const stubClientPath = join(projectPath, "stub-client", "LaravelSkir", "Client");
    const generatedPath = join(projectPath, "generated", "skirout");
    const runtimePath = process.env.SKIR_RUNTIME_PATH ?? resolve("../runtime");
    const generatorPath = resolve("dist/index.js");
    const skirBinPath = resolve("node_modules/skir/dist/compiler.js");

    expect(existsSync(generatorPath)).toBe(true);
    expect(existsSync(skirBinPath)).toBe(true);

    rmSync(skirSourcePath, { recursive: true, force: true });
    rmSync(generatedPath, { recursive: true, force: true });
    mkdirSync(adminSkirSourcePath, { recursive: true });
    mkdirSync(commonSkirSourcePath, { recursive: true });
    mkdirSync(stubClientPath, { recursive: true });

    writeFileSync(
      join(projectPath, "skir.yml"),
      [
        "generators:",
        `  - mod: ${pathToFileURL(generatorPath).href}`,
        "    outDir: generated/skirout",
        "    config:",
        '      namespace: "App\\\\Skir"',
        "",
      ].join("\n"),
    );

    writeFileSync(
      join(adminSkirSourcePath, "users.skir"),
      [
        'import { Address } from "../common/address.skir";',
        "",
        "struct User {",
        "  user_id: int32;",
        "  name: string;",
        "  address: Address;",
        "  previous_addresses: [Address];",
        "  subscription_status: SubscriptionStatus;",
        "  status_history: [SubscriptionStatus];",
        "}",
        "",
        "enum SubscriptionStatus {",
        "  free;",
        "  premium_since: timestamp;",
        "}",
        "",
        "method GetUser(User): User = 3180856469;",
        "",
      ].join("\n"),
    );

    writeFileSync(
      join(adminSkirSourcePath, "profiles.skir"),
      [
        "struct User {",
        "  display_name: string;",
        "}",
        "",
      ].join("\n"),
    );

    writeFileSync(
      join(commonSkirSourcePath, "address.skir"),
      [
        "struct Address {",
        "  city: string;",
        "  postal_codes: [string];",
        "}",
        "",
      ].join("\n"),
    );

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
              "App\\Skir\\": "generated/skirout/",
              "LaravelSkir\\Client\\": "stub-client/LaravelSkir/Client/",
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

    writeFileSync(
      join(stubClientPath, "SkirClient.php"),
      `<?php

declare(strict_types=1);

namespace LaravelSkir\\Client;

use LaravelSkir\\Runtime\\MethodDescriptor;

final class SkirClient
{
    public function invoke(MethodDescriptor $descriptor, mixed $request): mixed
    {
        if ($descriptor->name !== 'GetUser') {
            throw new \\RuntimeException('Unexpected method descriptor.');
        }

        return $request;
    }
}
`,
    );

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

use App\\Skir\\Admin\\SkirMethods;
use App\\Skir\\Admin\\SkirRpcClient;
use App\\Skir\\Admin\\SubscriptionStatusData;
use App\\Skir\\Admin\\UsersUserData;
use App\\Skir\\Common\\AddressData;
use LaravelSkir\\Client\\SkirClient as TransportSkirClient;

$user = new UsersUserData(
    userId: 400,
    name: 'John Doe',
    address: new AddressData(city: 'Antwerp', postalCodes: ['2000', '2018']),
    previousAddresses: [
        new AddressData(city: 'Brussels', postalCodes: ['1000']),
    ],
    subscriptionStatus: SubscriptionStatusData::premiumSince(1743682787000),
    statusHistory: [
        SubscriptionStatusData::free(),
        SubscriptionStatusData::premiumSince(1743682787000),
    ],
);

if ($user->toSkirJson() !== '[400,"John Doe",["Antwerp",["2000","2018"]],[["Brussels",["1000"]]],[2,1743682787000],[1,[2,1743682787000]]]') {
    throw new RuntimeException('Unexpected user dense JSON: '.$user->toSkirJson());
}

$decodedUser = UsersUserData::fromSkir('[400,"John Doe",["Antwerp",["2000","2018"]],[["Brussels",["1000"]]],[2,1743682787000],[1,[2,1743682787000]]]');

if ($decodedUser->address->city !== 'Antwerp' || $decodedUser->previousAddresses[0]->city !== 'Brussels') {
    throw new RuntimeException('Unexpected decoded user.');
}

if ($decodedUser->subscriptionStatus->name() !== 'premium_since' || $decodedUser->subscriptionStatus->payload() !== 1743682787000) {
    throw new RuntimeException('Unexpected decoded status field.');
}

if (count($decodedUser->statusHistory) !== 2 || $decodedUser->statusHistory[0]->name() !== 'free') {
    throw new RuntimeException('Unexpected decoded status history.');
}

$status = SubscriptionStatusData::premiumSince(1743682787000);

if ($status->toDenseJson() !== '[2,1743682787000]') {
    throw new RuntimeException('Unexpected status dense JSON: '.$status->toDenseJson());
}

$method = SkirMethods::getUser();

if ($method->name !== 'GetUser' || $method->number !== 3180856469) {
    throw new RuntimeException('Unexpected method descriptor.');
}

$rpcClient = new SkirRpcClient(new TransportSkirClient());
$rpcUser = $rpcClient->getUser($user);

if (! $rpcUser instanceof UsersUserData || $rpcUser->name !== 'John Doe') {
    throw new RuntimeException('Unexpected generated client response.');
}
`,
    );

    execFileSync("node", [skirBinPath, "gen", "--root", projectPath], {
      cwd: resolve("."),
      stdio: "pipe",
    });

    const generatedFiles = [
      join(generatedPath, "Admin", "UsersUserData.php"),
        join(generatedPath, "Admin", "ProfilesUserData.php"),
        join(generatedPath, "Admin", "SubscriptionStatusData.php"),
        join(generatedPath, "Admin", "SkirMethods.php"),
        join(generatedPath, "Admin", "SkirProcedureProvider.php"),
        join(generatedPath, "Admin", "SkirProcedures.php"),
        join(generatedPath, "Admin", "SkirRpcClient.php"),
        join(generatedPath, "Common", "AddressData.php"),
      ];

    for (const generatedFile of generatedFiles) {
      expect(existsSync(generatedFile)).toBe(true);
      execFileSync("php", ["-l", generatedFile], { stdio: "pipe" });
    }

    expect(existsSync(join(generatedPath, "Admin", "UserData.php"))).toBe(false);

      const userCode = readFileSync(join(generatedPath, "Admin", "UsersUserData.php"), "utf8");
      const methodsCode = readFileSync(join(generatedPath, "Admin", "SkirMethods.php"), "utf8");
      const providerCode = readFileSync(join(generatedPath, "Admin", "SkirProcedureProvider.php"), "utf8");
      const clientCode = readFileSync(join(generatedPath, "Admin", "SkirRpcClient.php"), "utf8");

      expect(userCode).toContain("use App\\Skir\\Common\\AddressData;");
      expect(userCode).not.toContain("\\App\\Skir\\Common\\AddressData");
      expect(methodsCode).toContain("requestType: UsersUserData::skirType()");
      expect(methodsCode).toContain("responseType: UsersUserData::skirType()");
      expect(providerCode).toContain("namespace App\\Skir\\Admin;");
      expect(clientCode).toContain("public function getUser(UsersUserData $request): UsersUserData");

    if (existsSync(join(projectPath, "vendor", "autoload.php"))) {
      execFileSync("composer", ["dump-autoload", "--no-interaction"], {
        cwd: projectPath,
        stdio: "pipe",
      });
    } else {
      execFileSync("composer", ["install", "--no-interaction", "--no-progress"], {
        cwd: projectPath,
        stdio: "pipe",
      });
    }

    execFileSync("php", ["verify.php"], {
      cwd: projectPath,
      stdio: "pipe",
    });
  }, 180_000);
});
