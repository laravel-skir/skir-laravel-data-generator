# Skir Laravel Data Generator

[![Tests](https://github.com/php-skir/skir-laravel-data-generator/actions/workflows/tests.yml/badge.svg)](https://github.com/php-skir/skir-laravel-data-generator/actions/workflows/tests.yml)
[![Coverage](https://raw.githubusercontent.com/php-skir/skir-laravel-data-generator/badges/coverage.svg)](https://github.com/php-skir/skir-laravel-data-generator/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/skir-laravel-data-generator?label=npm&logo=npm)](https://www.npmjs.com/package/skir-laravel-data-generator)
[![Node.js](https://img.shields.io/badge/Node.js-22%20%7C%2024-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/php-skir/skir-laravel-data-generator)](LICENSE)

Generates Spatie Laravel Data objects, typed RPC clients, and server procedure contracts from Skir schemas.

Generated PHP uses `spatie/laravel-data` for DTO creation and validation and `php-skir/runtime` for dense JSON serialization. Install `php-skir/client` when using generated RPC clients and `php-skir/server` when using generated server contracts.

## Installation

```bash
npm install --save-dev skir skir-laravel-data-generator
composer require php-skir/runtime spatie/laravel-data
```

For generated typed RPC clients:

```bash
composer require php-skir/client
```

For generated server contracts:

```bash
composer require php-skir/server
```

## Configure Skir

Add the Laravel Data generator to the root `skir.yml` using Skir's current array syntax:

```yaml
generators:
  - mod: skir-laravel-data-generator
    outDir: app/Skir/skirout
    config:
      namespace: Skir
```

Skir requires `outDir`. Keep each generator in a dedicated output directory whose path ends in `/skirout`; the suffix is the physical generated-ownership boundary. Skir owns that directory and may replace or delete anything inside it, so handwritten controllers and adapters must remain outside `outDir`.

The root namespace defaults to exactly `Skir`, so the `config` block can be omitted when that default is suitable. `Generated` is not added to the namespace because the physical `skirout` directory already identifies generated code.

Source directories below `skir-src` become PHP subnamespaces and output directories:

```text
skir-src/health/health.skir -> app/Skir/skirout/Health/HealthRequestData.php
                            -> Skir\Health\HealthRequestData
```

The `.skir` filename itself does not add a namespace segment. In this example, the `health` directory creates `Skir\Health`; the `health.skir` filename does not create another `Health` level.

Every emitted PHP file contains the same `DO NOT EDIT` banner. Change the `.skir` source or generator configuration and regenerate instead of editing generated PHP.

## Generate and configure Composer

Run generation before configuring Composer because the configurator verifies that every configured output directory exists:

```bash
npx skir gen
npx skir-laravel-data-generator configure-composer
composer dump-autoload
```

`configure-composer` reads `skir.yml` and `composer.json` from the project root, finds the matching `mod: skir-laravel-data-generator` entry, and registers its namespace and `outDir` as a Composer PSR-4 mapping. It updates `composer.json` atomically only when a mapping must be added.

The command deliberately does not execute Composer. `composer dump-autoload` is a separate command because Node and PHP may run in different containers or runtimes.

Use `--root <directory>` to select another project root. The internal/testing-oriented `--mod <module>` option selects an exact alternative generator identifier, such as a local file URL:

```bash
npx skir-laravel-data-generator configure-composer --root ../api --mod file:///path/to/skir-laravel-data-generator/dist/index.js
```

The configurator has three successful or terminal outcomes:

- **Added:** a missing `autoload.psr-4` object or namespace mapping is added with a minimal JSON edit.
- **No-op:** an existing equivalent mapping is left byte-for-byte unchanged.
- **Conflict:** an existing canonical prefix that points elsewhere, or a malformed near-match prefix, causes a nonzero exit without modifying `composer.json`. The command never appends to or merges a conflicting mapping.

Missing or invalid `skir.yml` and `composer.json`, invalid generator configuration, malformed namespaces, output paths that escape the project root, and missing generated output directories also fail without modifying `composer.json`.

For an ordered `outDir` array, every output directory must exist and remain inside the project root before any write occurs. The same order is preserved in Composer's array-valued PSR-4 mapping. An existing array must match the entire configured array in the same order; any difference is a conflict. This makes multi-output configuration all-or-nothing.

### Package script automation

Generation and Composer configuration can be combined in `package.json`:

```json
{
  "scripts": {
    "skir:generate": "skir gen && skir-laravel-data-generator configure-composer"
  }
}
```

Then run:

```bash
npm run skir:generate
```

Refresh Composer's generated autoloader as a separate follow-up step:

```bash
composer dump-autoload
```

### Manual Composer fallback

If Composer configuration is managed manually, map the root namespace to the same generator-owned `outDir` and include trailing slashes:

```json
{
  "autoload": {
    "psr-4": {
      "Skir\\": "app/Skir/skirout/"
    }
  }
}
```

After editing `composer.json`, run:

```bash
composer dump-autoload
```

## Generated PHP

The generator emits Laravel Data classes for Skir structs and wrapper classes for Skir enums. Generated classes expose:

- `skirType()` for runtime type descriptors.
- `fromSkir()` for dense JSON decoding with Laravel Data validation.
- `toSkir()` and `toSkirJson()` for dense JSON payloads.
- `toSkirValue()` and `fromSkirValue()` on generated enum classes.

SkirRPC methods are emitted in `SkirMethods.php` as `MethodDescriptor` instances. The generator also emits a module-scoped method enum such as `AdminSkirMethod.php` for attribute-based server routing.

When a module defines SkirRPC methods, the generator emits `SkirRpcClient.php`. It wraps `Skir\Client\SkirClient` and exposes typed methods:

```php
use Skir\Admin\SkirRpcClient;
use Skir\Client\SkirClient as TransportSkirClient;

$client = new SkirRpcClient(new TransportSkirClient('https://example.com/skir'));
$user = $client->getUser($requestData);
```

Responses are hydrated through `makeFromSkirPayload()`, so Laravel Data validation is applied to returned struct objects.

For servers, the generator emits a module method enum, `AbstractSkirProcedures.php`, `SkirProcedures.php`, and `SkirProcedureProvider.php`. Keep handwritten controllers in normal application namespaces while importing generated classes from `Skir`:

```php
namespace App\Http\Controllers;

use Skir\Admin\AdminSkirMethod;
use Skir\Admin\GetUserRequestData;
use Skir\Admin\UserData;
use Skir\Server\Attributes\SkirMethod;
use Skir\Server\SkirContext;

final class UserController
{
    #[SkirMethod(AdminSkirMethod::GetUser)]
    public function get(GetUserRequestData $request, SkirContext $context): UserData
    {
        return new UserData(
            userId: $request->userId,
            name: 'Maxim',
        );
    }
}
```

Register the handwritten controller on a Skir endpoint:

```php
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;
use Skir\Server\Facades\Skir;

Route::skirRpc('/api/skir', [
    Skir::controller(UserController::class),
]);
```

The method enum resolves to `SkirMethods::getUser()`, so the Skir schema remains the source of truth while the IDE can autocomplete enum cases. The server dispatcher hydrates incoming struct requests with `makeFromSkirPayload()` and converts returned data objects with `toSkirArray()`. Laravel Data validation runs before the controller method is called.

When two generated records would otherwise use the same PHP class name in one namespace, the generator prefixes each class with its module basename to keep output deterministic.

## Releasing

Create a GitHub release for the version in `package.json`. The release workflow reruns type checks, build, package validation, and tests before publishing to npm with provenance. It expects an `NPM_TOKEN` repository secret.
