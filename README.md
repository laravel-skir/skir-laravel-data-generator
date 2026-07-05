# Skir Laravel Data Generator

Generates Spatie Laravel Data objects for Skir schemas.

Generated PHP code uses `spatie/laravel-data` for DTO creation and validation, and `laravel-skir/runtime` for dense JSON serialization. If you use generated RPC clients, install `laravel-skir/client` as well.

## Installation

```bash
npm install --save-dev skir-laravel-data-generator
composer require laravel-skir/runtime spatie/laravel-data
```

For generated typed RPC clients:

```bash
composer require laravel-skir/client
```

## Releasing

Create a GitHub release for the version in `package.json`. The release workflow reruns type checks, build, package validation, and tests before publishing to npm with provenance. It expects an `NPM_TOKEN` repository secret.

## Usage with Skir

Add the generator to `skir.yml`:

```yaml
generators:
  laravel-data:
    package: skir-laravel-data-generator
    output: generated/php
    config:
      namespace: App\Skir
```

Then run the Skir generator command for your project.

## Generated PHP

The generator emits Laravel Data classes for Skir structs and enum wrapper classes for Skir enums. Generated classes expose:

- `skirType()` for runtime type descriptors.
- `fromSkir()` for dense JSON string creation with Laravel Data validation.
- `toSkir()` and `toSkirJson()` for dense JSON payloads.
- `toSkirValue()` and `fromSkirValue()` on generated enum classes.

SkirRPC methods are emitted in `SkirMethods.php` as `MethodDescriptor` instances.

When a module defines SkirRPC methods, the generator also emits `SkirRpcClient.php`. It wraps `LaravelSkir\Client\SkirClient` and exposes typed methods:

```php
use App\Skir\Admin\SkirRpcClient;
use LaravelSkir\Client\SkirClient as TransportSkirClient;

$client = new SkirRpcClient(new TransportSkirClient('https://example.com/skir'));
$user = $client->getUser($requestData);
```

Responses are hydrated through `makeFromSkirPayload()`, so Laravel Data validation is still applied to returned struct objects.

For servers, the generator emits `SkirProcedures.php` and `SkirProcedureProvider.php`. Implement the generated interface and register the generated provider on a Laravel Skir endpoint:

```php
use App\Skir\Admin\SkirProcedureProvider;
use App\Skir\Admin\SkirProcedures;
use Illuminate\Support\Facades\Route;

$this->app->bind(SkirProcedures::class, AdminProcedures::class);

Route::skirRpc('/api/skir', [
    SkirProcedureProvider::class,
]);
```

Incoming struct requests are hydrated with `makeFromSkirPayload()`, so Laravel Data validation also runs before your procedure implementation is called.

## Namespaces and modules

The configured namespace defaults to `App\Skir`. Module directories become PHP subnamespaces and output directories:

```text
admin/users.skir -> App\Skir\Admin
```

When two generated records would otherwise use the same PHP class name in the same namespace, the generator prefixes the class with the module basename to keep output deterministic.

## Current scope

This package generates Laravel Data DTOs, method descriptors, typed client adapters, and Laravel Skir server procedure adapters. Server routing lives in a separate package.
