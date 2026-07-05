# Skir Laravel Data Generator

Generates Spatie Laravel Data objects for Skir schemas.

Generated PHP code uses `spatie/laravel-data` for DTO creation and validation, and `laravel-skir/runtime` for dense JSON serialization.

## Installation

```bash
npm install --save-dev skir-laravel-data-generator
composer require laravel-skir/runtime spatie/laravel-data
```

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

## Namespaces and modules

The configured namespace defaults to `App\Skir`. Module directories become PHP subnamespaces and output directories:

```text
admin/users.skir -> App\Skir\Admin
```

When two generated records would otherwise use the same PHP class name in the same namespace, the generator prefixes the class with the module basename to keep output deterministic.

## Current scope

This package only generates Laravel Data DTOs and method descriptors. Server routing and client generation live in separate packages.
