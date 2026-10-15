/**
 * Read a `--no-<name>` boolean flag. citty parses `--no-<name>` as the negation of
 * `<name>` (`{ <name>: false }`) and leaves the declared `"no-<name>"` key at its
 * default, so `args["no-<name>"]` alone is always false.
 */
export function negatedFlag(args: Record<string, unknown>, name: string): boolean {
  return args[`no-${name}`] === true || args[name] === false;
}
