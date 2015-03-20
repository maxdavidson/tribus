
/**
 * Takes a type and returns a function that constructs a new object of that type.
 */
export const construct = Type => (...args) => new Type(...args);


/**
 *
 */
export const delegate = fn => (...args) => fn(...args)(...args);
