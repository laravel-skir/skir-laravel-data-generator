# Skir Laravel Data Generator

[![Tests](https://github.com/php-skir/skir-laravel-data-generator/actions/workflows/tests.yml/badge.svg)](https://github.com/php-skir/skir-laravel-data-generator/actions/workflows/tests.yml)
[![Coverage](https://raw.githubusercontent.com/php-skir/skir-laravel-data-generator/badges/coverage.svg)](https://github.com/php-skir/skir-laravel-data-generator/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/skir-laravel-data-generator?label=npm&logo=npm)](https://www.npmjs.com/package/skir-laravel-data-generator)
[![Node.js](https://img.shields.io/badge/Node.js-22%20%7C%2024-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/php-skir/skir-laravel-data-generator)](LICENSE)

Generates Spatie Laravel Data objects, typed RPC clients, and server procedure contracts from Skir schemas.

Generated PHP uses `spatie/laravel-data` for DTO creation and validation and `php-skir/runtime` for dense JSON serialization. Install `php-skir/client` when using generated RPC clients and `php-skir/server` when using generated server contracts.

The npm package uses [`@php-skir/generator-core`](https://github.com/php-skir/generator-core) at generation time for schema normalization, PHP naming and imports, shared enum and RPC rendering, server manifests, and Composer configuration. This adapter owns the Laravel Data class representation, hydration, collection metadata, and validation overlays. The generated PHP continues to use its Composer dependencies at runtime.

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

## Validation overlays

Laravel Data infers structural rules from generated property types and attributes. Add application-specific string rules under `config.validation` in `skir.yml`:

```yaml
generators:
  - mod: skir-laravel-data-generator
    outDir: app/Skir/skirout
    config:
      namespace: Skir
      validation:
        admin/users.skir:
          Envelope.Metadata:
            email_address:
              - required
              - email:rfc,dns
              - company_email
```

The three selector levels always use original Skir names:

- `admin/users.skir` is the original module path, including its `.skir` filename.
- `Envelope.Metadata` is the original qualified record name; nested records are separated with `.`.
- `email_address` is the original field name, even though the generated PHP property is `$emailAddress`.

Selectors are strict. Generation fails for an unknown module, record, or field, and validation can target only payload fields on generated structs. This prevents a misspelled rule from being silently ignored. Each configured field must contain a non-empty array of non-empty strings, and field and rule order is preserved in generated PHP.

For a configured struct, the generator adds `#[MergeValidationRules]` and a `rules()` method:

```php
use Spatie\LaravelData\Attributes\MergeValidationRules;

#[MergeValidationRules]
final class EnvelopeMetadataData extends Data
{
    /** @return array<string, list<string>> */
    public static function rules(): array
    {
        return [
            'email_address' => ['required', 'email:rfc,dns', 'company_email'],
        ];
    }
}
```

`MergeValidationRules` keeps Laravel Data's inferred rules and merges the configured rules into them. Leaving `validation` out, or setting it to an empty object, preserves the no-overlay generated bytes: records receive neither `MergeValidationRules` nor `rules()`.

### Register custom named rules

Custom named rules such as `company_email` must be registered before generated Data validation executes. In Laravel, register them during application boot, for example in `App\Providers\AppServiceProvider`:

```php
<?php

namespace App\Providers;

use Illuminate\Support\Facades\Validator;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Validator::extend(
            'company_email',
            static fn (string $attribute, mixed $value): bool =>
                is_string($value) && str_ends_with($value, '@company.test'),
        );
    }
}
```

Only Laravel validation rule strings are supported in `skir.yml`. Rule objects, closures, cross-field checks, authorization, and request-specific conditions belong in a handwritten Form Request or another application-owned validation boundary. Keep that code outside `skirout`: generated files are owned by Skir and will be overwritten.

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

### Struct collections and mapped fields

Skir `snake_case` fields use Laravel Data's `MapInputName` attribute while exposing camel-cased PHP properties. Direct `array<struct>` fields, including `optional<array<struct>>`, use `DataCollectionOf` so Laravel Data hydrates the struct items. Arrays whose items are optional structs and nested struct arrays are hydrated recursively without unsupported collection metadata; their PHP shape remains an array, including nullable items and nested arrays. Dense JSON conversion recursively unwraps the generated data objects again.

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

## Server scaffolding manifest

Each generation run writes `skir-server-manifest.json` at the root of the configured `outDir`. For the configuration above, the path is:

```text
app/Skir/skirout/skir-server-manifest.json
```

The manifest is consumed by the [`php-skir/server`](https://github.com/php-skir/server) Laravel scaffolding commands. Keep the manifest path in the server package configuration aligned with the generator `outDir`.

Each manifest module name is also its method ID prefix. Directory segments use the same normalization as their generated PHP namespace: `user-profile` becomes `UserProfile`, `admin/users` becomes `Admin.Users`, and a literal `admin.users` segment becomes `AdminUsers`. Root-level methods use the reserved `_Root` module name, while a `Root` directory remains `Root`. Generation fails when distinct directory names normalize to the same module identity.

The current schema version is `1`:

```json
{
  "version": 1,
  "generator": "skir-laravel-data-generator",
  "modules": [
    {
      "name": "Admin",
      "methodEnum": "Skir\\Admin\\AdminSkirMethod",
      "methods": [
        {
          "name": "GetUser",
          "enumCase": "GetUser",
          "phpMethod": "getUser",
          "requestType": "Skir\\Admin\\GetUserRequestData",
          "requestClass": "Skir\\Admin\\GetUserRequestData",
          "responseType": "Skir\\Admin\\GetUserResponseData",
          "responseClass": "Skir\\Admin\\GetUserResponseData"
        }
      ]
    }
  ]
}
```

`methodEnum` and record request and response types are fully qualified PHP names without a leading backslash. Generated record names include the Laravel Data `Data` suffix. `requestClass` is non-null only when the request is a generated object/struct data object that can be hydrated through a Form Request; enum and other value requests use `null` while `requestType` retains their PHP type. `responseClass` identifies a generated response class that can be imported. Scalar and union types use PHP type syntax and have a `null` class field. Optional object/struct requests keep their underlying data object in `requestClass`. Names are derived from the actual generated record location, including nested and cross-module references.

Run `npx skir gen` after changing a schema. No extra generator option is required to emit the manifest.

## Releasing

`@php-skir/generator-core` is a normal semver dependency of this package. Publish the required core version first, replace any local development link with that published version, update the lockfile, and verify a clean `npm ci` before releasing this adapter.

Create a GitHub release for the version in `package.json`. The release workflow reruns type checks, build, package validation, and tests before publishing to npm with provenance. Configure this GitHub repository and its `release.yml` workflow as an npm trusted publisher; the workflow authenticates through OIDC and does not use a long-lived npm token.
