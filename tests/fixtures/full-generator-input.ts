import type {
  ArrayType,
  CodeGenerator,
  Doc,
  Field,
  Import,
  Method,
  Module,
  OptionalType,
  Primitive,
  PrimitiveType,
  Record as ProducerRecord,
  RecordLocation,
  ResolvedRecordRef,
  ResolvedType,
  Token,
  UnresolvedArrayType,
  UnresolvedRecordRef,
  UnresolvedType,
} from "skir-internal";

import type { GeneratorConfig } from "../../src/config.js";
import type { PhpGeneratorInput } from "../../src/generator.js";

const moduleSources = {
  "common/address.skir": [
    "struct Address {",
    "  city: string = 0;",
    "  postal_codes: [string] = 1;",
    "}",
    "",
  ].join("\n"),
  "admin/users.skir": [
    'import { Address } from "../common/address.skir";',
    "",
    "struct User {",
    "  user_id: int32 = 0;",
    "  removed 1;",
    "  address: Address = 2;",
    "  previous_addresses: [Address] = 3;",
    "  nickname: string? = 4;",
    "  matrix: [[int32]] = 5;",
    "}",
    "",
    "enum SubscriptionStatus {",
    "  free = 0;",
    "  premium_since: timestamp = 1;",
    "}",
    "",
    "method GetUser(User): User = 1;",
    "method FindUsers(string?): [User] = 2;",
    "",
  ].join("\n"),
} as const;

type ModulePath = keyof typeof moduleSources;

const emptyDoc: Doc = {
  text: "",
  pieces: [],
};

function tokenAt(modulePath: ModulePath, text: string, occurrence = 0): Token {
  const sourceCode = moduleSources[modulePath];
  let position = -1;

  for (let index = 0; index <= occurrence; index += 1) {
    position = sourceCode.indexOf(text, position + 1);
  }

  if (position < 0) {
    throw new Error(`Token ${JSON.stringify(text)} not found in ${modulePath}.`);
  }

  const linePosition = sourceCode.lastIndexOf("\n", position - 1) + 1;
  const nextLinePosition = sourceCode.indexOf("\n", position);
  const line = sourceCode.slice(
    linePosition,
    nextLinePosition < 0 ? sourceCode.length : nextLinePosition,
  );
  const lineNumber = sourceCode.slice(0, linePosition).split("\n").length - 1;

  return {
    text,
    originalText: text,
    position,
    line: {
      lineNumber,
      line,
      position: linePosition,
      modulePath,
    },
    colNumber: position - linePosition,
  };
}

function primitive(primitiveType: Primitive): PrimitiveType {
  return {
    kind: "primitive",
    primitive: primitiveType,
  };
}

function array(type: ResolvedType): ArrayType<ResolvedType> {
  return {
    kind: "array",
    item: type,
    key: undefined,
  };
}

function unresolvedArray(type: UnresolvedType): UnresolvedArrayType {
  return {
    kind: "array",
    item: type,
    key: undefined,
  };
}

function optional(type: ResolvedType): OptionalType<ResolvedType> {
  return {
    kind: "optional",
    other: type,
  };
}

function unresolvedOptional(type: UnresolvedType): OptionalType<UnresolvedType> {
  return {
    kind: "optional",
    other: type,
  };
}

function field(
  name: Token,
  number: number,
  unresolvedType: UnresolvedType | undefined,
  type: ResolvedType | undefined,
): Field {
  return {
    kind: "field",
    name,
    number,
    doc: emptyDoc,
    unresolvedType,
    inlineRecord: undefined,
    type,
    isRecursive: false,
  };
}

function unresolvedRecordReference(refToken: Token): UnresolvedRecordRef {
  return {
    kind: "record",
    nameParts: [refToken],
    absolute: false,
  };
}

function resolvedRecordReference(
  key: string,
  recordType: "struct" | "enum",
  refToken: Token,
  declaration: ProducerRecord,
): ResolvedRecordRef {
  return {
    kind: "record",
    key,
    recordType,
    nameParts: [{ token: refToken, declaration }],
    refToken,
  };
}

const cityType = primitive("string");
const postalCodeType = primitive("string");
const postalCodesType = array(postalCodeType);
const unresolvedPostalCodesType = unresolvedArray(postalCodeType);
const cityField = field(
  tokenAt("common/address.skir", "city"),
  0,
  cityType,
  cityType,
);
const postalCodesField = field(
  tokenAt("common/address.skir", "postal_codes"),
  1,
  unresolvedPostalCodesType,
  postalCodesType,
);

const address: ProducerRecord = {
  kind: "record",
  key: "address-key",
  name: tokenAt("common/address.skir", "Address"),
  recordType: "struct",
  doc: emptyDoc,
  nameToDeclaration: {
    city: cityField,
    postal_codes: postalCodesField,
  },
  declarations: [cityField, postalCodesField],
  fields: [cityField, postalCodesField],
  nestedRecords: [],
  removedNumbers: [],
  recordNumber: null,
  numSlots: 2,
  numSlotsInclRemovedNumbers: 2,
};

const userIdType = primitive("int32");
const addressTypeToken = tokenAt("admin/users.skir", "Address", 1);
const previousAddressTypeToken = tokenAt("admin/users.skir", "Address", 2);
const addressType = resolvedRecordReference(
  "address-key",
  "struct",
  addressTypeToken,
  address,
);
const previousAddressType = resolvedRecordReference(
  "address-key",
  "struct",
  previousAddressTypeToken,
  address,
);
const unresolvedAddressType = unresolvedRecordReference(addressTypeToken);
const unresolvedPreviousAddressType = unresolvedRecordReference(previousAddressTypeToken);
const previousAddressesType = array(previousAddressType);
const unresolvedPreviousAddressesType = unresolvedArray(unresolvedPreviousAddressType);
const nicknameStringType = primitive("string");
const nicknameType = optional(nicknameStringType);
const unresolvedNicknameType = unresolvedOptional(nicknameStringType);
const matrixIntType = primitive("int32");
const matrixType = array(array(matrixIntType));
const unresolvedMatrixType = unresolvedArray(unresolvedArray(matrixIntType));
const userIdField = field(
  tokenAt("admin/users.skir", "user_id"),
  0,
  userIdType,
  userIdType,
);
const addressField = field(
  tokenAt("admin/users.skir", "address"),
  2,
  unresolvedAddressType,
  addressType,
);
const previousAddressesField = field(
  tokenAt("admin/users.skir", "previous_addresses"),
  3,
  unresolvedPreviousAddressesType,
  previousAddressesType,
);
const nicknameField = field(
  tokenAt("admin/users.skir", "nickname"),
  4,
  unresolvedNicknameType,
  nicknameType,
);
const matrixField = field(
  tokenAt("admin/users.skir", "matrix"),
  5,
  unresolvedMatrixType,
  matrixType,
);

const user: ProducerRecord = {
  kind: "record",
  key: "admin-user-key",
  name: tokenAt("admin/users.skir", "User"),
  recordType: "struct",
  doc: emptyDoc,
  nameToDeclaration: {
    user_id: userIdField,
    address: addressField,
    previous_addresses: previousAddressesField,
    nickname: nicknameField,
    matrix: matrixField,
  },
  declarations: [
    userIdField,
    addressField,
    previousAddressesField,
    nicknameField,
    matrixField,
  ],
  fields: [
    userIdField,
    addressField,
    previousAddressesField,
    nicknameField,
    matrixField,
  ],
  nestedRecords: [],
  removedNumbers: [1],
  recordNumber: null,
  numSlots: 6,
  numSlotsInclRemovedNumbers: 6,
};

const premiumSinceType = primitive("timestamp");
const freeField = field(
  tokenAt("admin/users.skir", "free"),
  0,
  undefined,
  undefined,
);
const premiumSinceField = field(
  tokenAt("admin/users.skir", "premium_since"),
  1,
  premiumSinceType,
  premiumSinceType,
);

const subscriptionStatus: ProducerRecord = {
  kind: "record",
  key: "subscription-status-key",
  name: tokenAt("admin/users.skir", "SubscriptionStatus"),
  recordType: "enum",
  doc: emptyDoc,
  nameToDeclaration: {
    free: freeField,
    premium_since: premiumSinceField,
  },
  declarations: [freeField, premiumSinceField],
  fields: [freeField, premiumSinceField],
  nestedRecords: [],
  removedNumbers: [],
  recordNumber: null,
  numSlots: 0,
  numSlotsInclRemovedNumbers: 0,
};

const getUserRequestToken = tokenAt("admin/users.skir", "User", 2);
const getUserResponseToken = tokenAt("admin/users.skir", "User", 3);
const findUsersRequestType = optional(primitive("string"));
const unresolvedFindUsersRequestType = unresolvedOptional(primitive("string"));
const findUsersResponseToken = tokenAt("admin/users.skir", "User", 5);
const getUserMethod: Method = {
  kind: "method",
  name: tokenAt("admin/users.skir", "GetUser"),
  doc: emptyDoc,
  unresolvedRequestType: unresolvedRecordReference(getUserRequestToken),
  inlineRequestRecord: undefined,
  requestType: resolvedRecordReference(
    "admin-user-key",
    "struct",
    getUserRequestToken,
    user,
  ),
  unresolvedResponseType: unresolvedRecordReference(getUserResponseToken),
  inlineResponseRecord: undefined,
  responseType: resolvedRecordReference(
    "admin-user-key",
    "struct",
    getUserResponseToken,
    user,
  ),
  number: 1,
};
const findUsersMethod: Method = {
  kind: "method",
  name: tokenAt("admin/users.skir", "FindUsers"),
  doc: emptyDoc,
  unresolvedRequestType: unresolvedFindUsersRequestType,
  inlineRequestRecord: undefined,
  requestType: findUsersRequestType,
  unresolvedResponseType: unresolvedArray(unresolvedRecordReference(findUsersResponseToken)),
  inlineResponseRecord: undefined,
  responseType: array(resolvedRecordReference(
    "admin-user-key",
    "struct",
    findUsersResponseToken,
    user,
  )),
  number: 2,
};

const addressLocation: RecordLocation = {
  kind: "record-location",
  modulePath: "common/address.skir",
  record: address,
  recordAncestors: [address],
};
const userLocation: RecordLocation = {
  kind: "record-location",
  modulePath: "admin/users.skir",
  record: user,
  recordAncestors: [user],
};
const subscriptionStatusLocation: RecordLocation = {
  kind: "record-location",
  modulePath: "admin/users.skir",
  record: subscriptionStatus,
  recordAncestors: [subscriptionStatus],
};

const addressModule: Module = {
  kind: "module",
  path: "common/address.skir",
  sourceCode: moduleSources["common/address.skir"],
  nameToDeclaration: {
    Address: address,
  },
  declarations: [address],
  pathToImportedNames: {},
  importBlockRange: null,
  records: [addressLocation],
  methods: [],
  brokenMethods: [],
  constants: [],
  brokenConstants: [],
};

const importToken = tokenAt("admin/users.skir", "import");
const importModulePathToken = tokenAt(
  "admin/users.skir",
  '"../common/address.skir"',
);
const addressImport: Import = {
  kind: "import",
  importToken,
  importedNames: [tokenAt("admin/users.skir", "Address")],
  modulePath: importModulePathToken,
  range: {
    start: importToken.position,
    end: importModulePathToken.position + importModulePathToken.text.length + 1,
  },
  resolvedModulePath: "common/address.skir",
};
const usersModule: Module = {
  kind: "module",
  path: "admin/users.skir",
  sourceCode: moduleSources["admin/users.skir"],
  nameToDeclaration: {
    Address: addressImport,
    User: user,
    SubscriptionStatus: subscriptionStatus,
    GetUser: getUserMethod,
    FindUsers: findUsersMethod,
  },
  declarations: [
    addressImport,
    user,
    subscriptionStatus,
    getUserMethod,
    findUsersMethod,
  ],
  pathToImportedNames: {
    "common/address.skir": {
      kind: "some",
      names: new Set(["Address"]),
    },
  },
  importBlockRange: {
    start: importToken.position,
    end: importModulePathToken.position + importModulePathToken.text.length + 1,
  },
  records: [userLocation, subscriptionStatusLocation],
  methods: [getUserMethod, findUsersMethod],
  brokenMethods: [],
  constants: [],
  brokenConstants: [],
};

const producerInput = {
  config: { namespace: "Skir" },
  modules: [addressModule, usersModule],
  recordMap: new Map<string, RecordLocation>([
    ["address-key", addressLocation],
    ["admin-user-key", userLocation],
    ["subscription-status-key", subscriptionStatusLocation],
  ]),
} satisfies CodeGenerator.Input<GeneratorConfig>;

export const fullGeneratorInput = producerInput satisfies PhpGeneratorInput;
