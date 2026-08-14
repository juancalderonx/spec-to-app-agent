import ts from "typescript";
import type { SurfaceEntry, SurfaceExport, SurfaceManifest } from "../graph/state.ts";
import { listFilesIn, readFileIn, type Sandbox } from "../tools/fs.ts";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/**
 * Reads every source file below `directory` and records what each one exposes.
 *
 * This is what lets the agent reuse an operation the project already ships
 * instead of writing a duplicate that does not match its mock handlers. The
 * reads go through the sandboxed tools, so each one lands in the trace.
 */
export async function readSurface(
  sandbox: Sandbox,
  directory: string,
): Promise<SurfaceManifest> {
  const manifest: SurfaceManifest = {};
  for (const file of await listFilesIn(sandbox, directory)) {
    if (SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension))) {
      manifest[file] = parseSurface(file, await readFileIn(sandbox, file));
    }
  }
  return manifest;
}

/**
 * Extracts a file's exported names and their signatures.
 *
 * Syntax only — no `ts.Program`, no type checker, no `tsconfig.json`
 * resolution, no disk access. Two consequences worth knowing before reading a
 * manifest:
 *
 * - A signature is worth exactly what the source's annotations are worth.
 *   Where a declaration omits its parameter or return types, so does the
 *   manifest: nothing here infers them. The provided project's `App` comes out
 *   as `function App()` for that reason, not because the parse missed
 *   something. Inference would mean building a program per parse, and
 *   `generate` re-parses on every file it writes.
 * - Nothing below a declaration's head is read. Statement bodies are never
 *   visited, so no value computed inside one can reach a prompt.
 */
export function parseSurface(fileName: string, source: string): SurfaceEntry {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    // No parent pointers, so `getText()` cannot walk up to the source file on
    // its own: every read below passes `file` explicitly.
    false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  return {
    exports: file.statements.flatMap((statement) => describe(statement, file)),
  };
}

function describe(statement: ts.Statement, file: ts.SourceFile): SurfaceExport[] {
  // `export { … }` and `export default <expression>` carry no export modifier:
  // they are export statements rather than exported declarations.
  if (ts.isExportDeclaration(statement)) {
    return reExports(statement, file);
  }
  if (ts.isExportAssignment(statement)) {
    return [{ name: "default", signature: expressionShape(statement.expression, file) }];
  }
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return [];
  }

  if (ts.isFunctionDeclaration(statement)) {
    const declared = statement.name?.text ?? "default";
    return [
      {
        name: exportedName(statement, declared),
        signature: `${asyncPrefix(statement)}function ${declared}${callableSignature(statement, file)}`,
      },
    ];
  }
  if (ts.isClassDeclaration(statement)) {
    const declared = statement.name?.text ?? "default";
    return [{ name: exportedName(statement, declared), signature: `class ${declared}` }];
  }
  // A type declaration has no body: its members are the signature.
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return [{ name: statement.name.text, signature: declarationText(statement, file) }];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((declaration) =>
      variableSignature(declaration, file),
    );
  }
  return [];
}

function reExports(statement: ts.ExportDeclaration, file: ts.SourceFile): SurfaceExport[] {
  const signature = declarationText(statement, file);
  const clause = statement.exportClause;
  if (clause !== undefined && ts.isNamedExports(clause)) {
    return clause.elements.map((element) => ({ name: element.name.text, signature }));
  }
  // `export * from "…"`: the names live in the other file, which has its own
  // manifest entry. Recorded rather than dropped, so the re-export is visible.
  return [{ name: "*", signature }];
}

function variableSignature(
  declaration: ts.VariableDeclaration,
  file: ts.SourceFile,
): SurfaceExport {
  const name = text(declaration.name, file);
  if (declaration.type !== undefined) {
    return { name, signature: `const ${name}: ${text(declaration.type, file)}` };
  }
  if (declaration.initializer === undefined) {
    return { name, signature: `const ${name}` };
  }
  return { name, signature: `const ${name} = ${expressionShape(declaration.initializer, file)}` };
}

/**
 * Describes what an initializer *is* without reproducing what it contains.
 *
 * Call and object arguments are elided because they are values. A tagged
 * template is not: a GraphQL document is declarative from end to end, and its
 * selection set is the contract of what comes back. Eliding it would leave the
 * generator knowing an operation exists but not which fields it requests, which
 * fails at runtime rather than at the type check.
 *
 * Known ceiling: an oversized template travels whole. `truncate` from the tool
 * trace is the fix if a project ever ships one.
 */
function expressionShape(expression: ts.Expression, file: ts.SourceFile): string {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return `${asyncPrefix(expression)}${callableSignature(expression, file)}`;
  }
  if (ts.isNewExpression(expression)) {
    return `new ${text(expression.expression, file)}(…)`;
  }
  if (ts.isCallExpression(expression)) {
    return `${text(expression.expression, file)}(…)`;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return "[…]";
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return "{…}";
  }
  return text(expression, file);
}

function asyncPrefix(node: ts.Node): string {
  return hasModifier(node, ts.SyntaxKind.AsyncKeyword) ? "async " : "";
}

function callableSignature(node: ts.SignatureDeclarationBase, file: ts.SourceFile): string {
  const generics =
    node.typeParameters === undefined
      ? ""
      : `<${node.typeParameters.map((parameter) => text(parameter, file)).join(", ")}>`;
  const parameters = node.parameters.map((parameter) => text(parameter, file)).join(", ");
  const returns = node.type === undefined ? "" : `: ${text(node.type, file)}`;
  return `${generics}(${parameters})${returns}`;
}

function exportedName(node: ts.Node, declared: string): string {
  return hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? "default" : declared;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
}

/** The declaration as written, minus the keywords already carried by `name`. */
function declarationText(node: ts.Node, file: ts.SourceFile): string {
  return text(node, file).replace(/^export\s+(default\s+)?/, "");
}

/** Source text of one node, on a single line. Never called on a body. */
function text(node: ts.Node, file: ts.SourceFile): string {
  return node.getText(file).replace(/\s+/g, " ");
}
