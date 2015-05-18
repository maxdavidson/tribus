(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  function dedupe(deps) {
    var newDeps = [];
    for (var i = 0, l = deps.length; i < l; i++)
      if (indexOf.call(newDeps, deps[i]) == -1)
        newDeps.push(deps[i])
    return newDeps;
  }

  function register(name, deps, declare, execute) {
    if (typeof name != 'string')
      throw "System.register provided no module name";

    var entry;

    // dynamic
    if (typeof declare == 'boolean') {
      entry = {
        declarative: false,
        deps: deps,
        execute: execute,
        executingRequire: declare
      };
    }
    else {
      // ES6 declarative
      entry = {
        declarative: true,
        deps: deps,
        declare: declare
      };
    }

    entry.name = name;

    // we never overwrite an existing define
    if (!(name in defined))
      defined[name] = entry; 

    entry.deps = dedupe(entry.deps);

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }

  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];

      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;

      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {

        // if already in a group, remove from the old group
        if (depEntry.groupIndex !== undefined) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;
      exports[name] = value;

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          var importerIndex = indexOf.call(importerModule.dependencies, module);
          importerModule.setters[importerIndex](exports);
        }
      }

      module.locked = false;
      return value;
    });

    module.setters = declaration.setters;
    module.execute = declaration.execute;

    if (!module.setters || !module.execute)
      throw new TypeError("Invalid System.register form for " + entry.name);

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        if (depEntry.module.exports && depEntry.module.exports.__esModule)
          depExports = depEntry.module.exports;
        else
          depExports = { 'default': depEntry.module.exports, __useDefault: true };
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);

      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);

    if (output)
      module.exports = output;
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (!entry || entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    var module = entry.module.exports;

    if (!module || !entry.declarative && module.__esModule !== true)
      module = { 'default': module, __useDefault: true };

    // return the defined module object
    return modules[name] = module;
  };

  return function(mains, declare) {

    var System;
    var System = {
      register: register, 
      get: load, 
      set: function(name, module) {
        modules[name] = module; 
      },
      newModule: function(module) {
        return module;
      },
      global: global 
    };
    System.set('@empty', {});

    declare(System);

    for (var i = 0; i < mains.length; i++)
      load(mains[i]);
  }

})(typeof window != 'undefined' ? window : global)
/* (['mainModule'], function(System) {
  System.register(...);
}); */

(['lib/extra/exporter'], function(System) {

System.register("npm:core-js@0.9.10/library/modules/$.fw", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function($) {
    $.FW = false;
    $.path = $.core;
    return $;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/helpers/class-call-check", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  exports["default"] = function(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.uid", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var sid = 0;
  function uid(key) {
    return 'Symbol('.concat(key === undefined ? '' : key, ')_', (++sid + Math.random()).toString(36));
  }
  uid.safe = require("npm:core-js@0.9.10/library/modules/$").g.Symbol || uid;
  module.exports = uid;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.redef", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:core-js@0.9.10/library/modules/$").hide;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.string-at", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$");
  module.exports = function(TO_STRING) {
    return function(that, pos) {
      var s = String($.assertDefined(that)),
          i = $.toInteger(pos),
          l = s.length,
          a,
          b;
      if (i < 0 || i >= l)
        return TO_STRING ? '' : undefined;
      a = s.charCodeAt(i);
      return a < 0xd800 || a > 0xdbff || i + 1 === l || (b = s.charCodeAt(i + 1)) < 0xdc00 || b > 0xdfff ? TO_STRING ? s.charAt(i) : a : TO_STRING ? s.slice(i, i + 2) : (a - 0xd800 << 10) + (b - 0xdc00) + 0x10000;
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.assert", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$");
  function assert(condition, msg1, msg2) {
    if (!condition)
      throw TypeError(msg2 ? msg1 + msg2 : msg1);
  }
  assert.def = $.assertDefined;
  assert.fn = function(it) {
    if (!$.isFunction(it))
      throw TypeError(it + ' is not a function!');
    return it;
  };
  assert.obj = function(it) {
    if (!$.isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  assert.inst = function(it, Constructor, name) {
    if (!(it instanceof Constructor))
      throw TypeError(name + ": use the 'new' operator!");
    return it;
  };
  module.exports = assert;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.def", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      global = $.g,
      core = $.core,
      isFunction = $.isFunction;
  function ctx(fn, that) {
    return function() {
      return fn.apply(that, arguments);
    };
  }
  $def.F = 1;
  $def.G = 2;
  $def.S = 4;
  $def.P = 8;
  $def.B = 16;
  $def.W = 32;
  function $def(type, name, source) {
    var key,
        own,
        out,
        exp,
        isGlobal = type & $def.G,
        isProto = type & $def.P,
        target = isGlobal ? global : type & $def.S ? global[name] : (global[name] || {}).prototype,
        exports = isGlobal ? core : core[name] || (core[name] = {});
    if (isGlobal)
      source = name;
    for (key in source) {
      own = !(type & $def.F) && target && key in target;
      if (own && key in exports)
        continue;
      out = own ? target[key] : source[key];
      if (isGlobal && !isFunction(target[key]))
        exp = source[key];
      else if (type & $def.B && own)
        exp = ctx(out, global);
      else if (type & $def.W && target[key] == out)
        !function(C) {
          exp = function(param) {
            return this instanceof C ? new C(param) : C(param);
          };
          exp.prototype = C.prototype;
        }(out);
      else
        exp = isProto && isFunction(out) ? ctx(Function.call, out) : out;
      exports[key] = exp;
      if (isProto)
        (exports.prototype || (exports.prototype = {}))[key] = out;
    }
  }
  module.exports = $def;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.unscope", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      UNSCOPABLES = require("npm:core-js@0.9.10/library/modules/$.wks")('unscopables');
  if ($.FW && !(UNSCOPABLES in []))
    $.hide(Array.prototype, UNSCOPABLES, {});
  module.exports = function(key) {
    if ($.FW)
      [][UNSCOPABLES][key] = true;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.ctx", ["npm:core-js@0.9.10/library/modules/$.assert"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var assertFunction = require("npm:core-js@0.9.10/library/modules/$.assert").fn;
  module.exports = function(fn, that, length) {
    assertFunction(fn);
    if (~length && that === undefined)
      return fn;
    switch (length) {
      case 1:
        return function(a) {
          return fn.call(that, a);
        };
      case 2:
        return function(a, b) {
          return fn.call(that, a, b);
        };
      case 3:
        return function(a, b, c) {
          return fn.call(that, a, b, c);
        };
    }
    return function() {
      return fn.apply(that, arguments);
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.iter-call", ["npm:core-js@0.9.10/library/modules/$.assert"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var assertObject = require("npm:core-js@0.9.10/library/modules/$.assert").obj;
  function close(iterator) {
    var ret = iterator['return'];
    if (ret !== undefined)
      assertObject(ret.call(iterator));
  }
  function call(iterator, fn, value, entries) {
    try {
      return entries ? fn(assertObject(value)[0], value[1]) : fn(value);
    } catch (e) {
      close(iterator);
      throw e;
    }
  }
  call.close = close;
  module.exports = call;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.set-proto", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.assert", "npm:core-js@0.9.10/library/modules/$.ctx"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      assert = require("npm:core-js@0.9.10/library/modules/$.assert");
  function check(O, proto) {
    assert.obj(O);
    assert(proto === null || $.isObject(proto), proto, ": can't set as prototype!");
  }
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(buggy, set) {
      try {
        set = require("npm:core-js@0.9.10/library/modules/$.ctx")(Function.call, $.getDesc(Object.prototype, '__proto__').set, 2);
        set({}, []);
      } catch (e) {
        buggy = true;
      }
      return function setPrototypeOf(O, proto) {
        check(O, proto);
        if (buggy)
          O.__proto__ = proto;
        else
          set(O, proto);
        return O;
      };
    }() : undefined),
    check: check
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.species", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      SPECIES = require("npm:core-js@0.9.10/library/modules/$.wks")('species');
  module.exports = function(C) {
    if ($.DESC && !(SPECIES in C))
      $.setDesc(C, SPECIES, {
        configurable: true,
        get: $.that
      });
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.invoke", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(fn, args, that) {
    var un = that === undefined;
    switch (args.length) {
      case 0:
        return un ? fn() : fn.call(that);
      case 1:
        return un ? fn(args[0]) : fn.call(that, args[0]);
      case 2:
        return un ? fn(args[0], args[1]) : fn.call(that, args[0], args[1]);
      case 3:
        return un ? fn(args[0], args[1], args[2]) : fn.call(that, args[0], args[1], args[2]);
      case 4:
        return un ? fn(args[0], args[1], args[2], args[3]) : fn.call(that, args[0], args[1], args[2], args[3]);
      case 5:
        return un ? fn(args[0], args[1], args[2], args[3], args[4]) : fn.call(that, args[0], args[1], args[2], args[3], args[4]);
    }
    return fn.apply(that, args);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.dom-create", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      document = $.g.document,
      isObject = $.isObject,
      is = isObject(document) && isObject(document.createElement);
  module.exports = function(it) {
    return is ? document.createElement(it) : {};
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:process@0.10.1/browser", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var process = module.exports = {};
  var queue = [];
  var draining = false;
  function drainQueue() {
    if (draining) {
      return ;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while (len) {
      currentQueue = queue;
      queue = [];
      var i = -1;
      while (++i < len) {
        currentQueue[i]();
      }
      len = queue.length;
    }
    draining = false;
  }
  process.nextTick = function(fun) {
    queue.push(fun);
    if (!draining) {
      setTimeout(drainQueue, 0);
    }
  };
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  process.version = '';
  process.versions = {};
  function noop() {}
  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.binding = function(name) {
    throw new Error('process.binding is not supported');
  };
  process.cwd = function() {
    return '/';
  };
  process.chdir = function(dir) {
    throw new Error('process.chdir is not supported');
  };
  process.umask = function() {
    return 0;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.mix", ["npm:core-js@0.9.10/library/modules/$.redef"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $redef = require("npm:core-js@0.9.10/library/modules/$.redef");
  module.exports = function(target, src) {
    for (var key in src)
      $redef(target, key, src[key]);
    return target;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.iter-detect", ["npm:core-js@0.9.10/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var SYMBOL_ITERATOR = require("npm:core-js@0.9.10/library/modules/$.wks")('iterator'),
      SAFE_CLOSING = false;
  try {
    var riter = [7][SYMBOL_ITERATOR]();
    riter['return'] = function() {
      SAFE_CLOSING = true;
    };
    Array.from(riter, function() {
      throw 2;
    });
  } catch (e) {}
  module.exports = function(exec) {
    if (!SAFE_CLOSING)
      return false;
    var safe = false;
    try {
      var arr = [7],
          iter = arr[SYMBOL_ITERATOR]();
      iter.next = function() {
        safe = true;
      };
      arr[SYMBOL_ITERATOR] = function() {
        return iter;
      };
      exec(arr);
    } catch (e) {}
    return safe;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.array-methods", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.ctx"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      ctx = require("npm:core-js@0.9.10/library/modules/$.ctx");
  module.exports = function(TYPE) {
    var IS_MAP = TYPE == 1,
        IS_FILTER = TYPE == 2,
        IS_SOME = TYPE == 3,
        IS_EVERY = TYPE == 4,
        IS_FIND_INDEX = TYPE == 6,
        NO_HOLES = TYPE == 5 || IS_FIND_INDEX;
    return function($this, callbackfn, that) {
      var O = Object($.assertDefined($this)),
          self = $.ES5Object(O),
          f = ctx(callbackfn, that, 3),
          length = $.toLength(self.length),
          index = 0,
          result = IS_MAP ? Array(length) : IS_FILTER ? [] : undefined,
          val,
          res;
      for (; length > index; index++)
        if (NO_HOLES || index in self) {
          val = self[index];
          res = f(val, index, O);
          if (TYPE) {
            if (IS_MAP)
              result[index] = res;
            else if (res)
              switch (TYPE) {
                case 3:
                  return true;
                case 5:
                  return val;
                case 6:
                  return index;
                case 2:
                  result.push(val);
              }
            else if (IS_EVERY)
              return false;
          }
        }
      return IS_FIND_INDEX ? -1 : IS_SOME || IS_EVERY ? IS_EVERY : result;
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.collection", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.def", "npm:core-js@0.9.10/library/modules/$.iter", "npm:core-js@0.9.10/library/modules/$.for-of", "npm:core-js@0.9.10/library/modules/$.species", "npm:core-js@0.9.10/library/modules/$.assert", "npm:core-js@0.9.10/library/modules/$.redef", "npm:core-js@0.9.10/library/modules/$.mix", "npm:core-js@0.9.10/library/modules/$.iter-detect", "npm:core-js@0.9.10/library/modules/$.cof"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      $def = require("npm:core-js@0.9.10/library/modules/$.def"),
      BUGGY = require("npm:core-js@0.9.10/library/modules/$.iter").BUGGY,
      forOf = require("npm:core-js@0.9.10/library/modules/$.for-of"),
      species = require("npm:core-js@0.9.10/library/modules/$.species"),
      assertInstance = require("npm:core-js@0.9.10/library/modules/$.assert").inst;
  module.exports = function(NAME, methods, common, IS_MAP, IS_WEAK) {
    var Base = $.g[NAME],
        C = Base,
        ADDER = IS_MAP ? 'set' : 'add',
        proto = C && C.prototype,
        O = {};
    function fixMethod(KEY, CHAIN) {
      if ($.FW) {
        var method = proto[KEY];
        require("npm:core-js@0.9.10/library/modules/$.redef")(proto, KEY, function(a, b) {
          var result = method.call(this, a === 0 ? 0 : a, b);
          return CHAIN ? this : result;
        });
      }
    }
    if (!$.isFunction(C) || !(IS_WEAK || !BUGGY && proto.forEach && proto.entries)) {
      C = common.getConstructor(NAME, IS_MAP, ADDER);
      require("npm:core-js@0.9.10/library/modules/$.mix")(C.prototype, methods);
    } else {
      var inst = new C,
          chain = inst[ADDER](IS_WEAK ? {} : -0, 1),
          buggyZero;
      if (!require("npm:core-js@0.9.10/library/modules/$.iter-detect")(function(iter) {
        new C(iter);
      })) {
        C = function() {
          assertInstance(this, C, NAME);
          var that = new Base,
              iterable = arguments[0];
          if (iterable != undefined)
            forOf(iterable, IS_MAP, that[ADDER], that);
          return that;
        };
        C.prototype = proto;
        if ($.FW)
          proto.constructor = C;
      }
      IS_WEAK || inst.forEach(function(val, key) {
        buggyZero = 1 / key === -Infinity;
      });
      if (buggyZero) {
        fixMethod('delete');
        fixMethod('has');
        IS_MAP && fixMethod('get');
      }
      if (buggyZero || chain !== inst)
        fixMethod(ADDER, true);
    }
    require("npm:core-js@0.9.10/library/modules/$.cof").set(C, NAME);
    O[NAME] = C;
    $def($def.G + $def.W + $def.F * (C != Base), O);
    species(C);
    species($.core[NAME]);
    if (!IS_WEAK)
      common.setIter(C, NAME, IS_MAP);
    return C;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/core.iter-helpers", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.iter"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var core = require("npm:core-js@0.9.10/library/modules/$").core,
      $iter = require("npm:core-js@0.9.10/library/modules/$.iter");
  core.isIterable = $iter.is;
  core.getIterator = $iter.get;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.weak-set", ["npm:core-js@0.9.10/library/modules/$.collection-weak", "npm:core-js@0.9.10/library/modules/$.collection"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var weak = require("npm:core-js@0.9.10/library/modules/$.collection-weak");
  require("npm:core-js@0.9.10/library/modules/$.collection")('WeakSet', {add: function add(value) {
      return weak.def(this, value, true);
    }}, weak, false, true);
  global.define = __define;
  return module.exports;
});

(function() {
function define(){};  define.amd = {};
(function(_global) {
  "use strict";
  var shim = {};
  if (typeof(exports) === 'undefined') {
    if (typeof define == 'function' && typeof define.amd == 'object' && define.amd) {
      shim.exports = {};
      System.register("github:toji/gl-matrix@master/dist/gl-matrix", [], false, function() {
        return shim.exports;
      });
    } else {
      shim.exports = typeof(window) !== 'undefined' ? window : _global;
    }
  } else {
    shim.exports = exports;
  }
  (function(exports) {
    if (!GLMAT_EPSILON) {
      var GLMAT_EPSILON = 0.000001;
    }
    if (!GLMAT_ARRAY_TYPE) {
      var GLMAT_ARRAY_TYPE = (typeof Float32Array !== 'undefined') ? Float32Array : Array;
    }
    if (!GLMAT_RANDOM) {
      var GLMAT_RANDOM = Math.random;
    }
    var glMatrix = {};
    glMatrix.setMatrixArrayType = function(type) {
      GLMAT_ARRAY_TYPE = type;
    };
    if (typeof(exports) !== 'undefined') {
      exports.glMatrix = glMatrix;
    }
    var degree = Math.PI / 180;
    glMatrix.toRadian = function(a) {
      return a * degree;
    };
    ;
    var vec2 = {};
    vec2.create = function() {
      var out = new GLMAT_ARRAY_TYPE(2);
      out[0] = 0;
      out[1] = 0;
      return out;
    };
    vec2.clone = function(a) {
      var out = new GLMAT_ARRAY_TYPE(2);
      out[0] = a[0];
      out[1] = a[1];
      return out;
    };
    vec2.fromValues = function(x, y) {
      var out = new GLMAT_ARRAY_TYPE(2);
      out[0] = x;
      out[1] = y;
      return out;
    };
    vec2.copy = function(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      return out;
    };
    vec2.set = function(out, x, y) {
      out[0] = x;
      out[1] = y;
      return out;
    };
    vec2.add = function(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      return out;
    };
    vec2.subtract = function(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      return out;
    };
    vec2.sub = vec2.subtract;
    vec2.multiply = function(out, a, b) {
      out[0] = a[0] * b[0];
      out[1] = a[1] * b[1];
      return out;
    };
    vec2.mul = vec2.multiply;
    vec2.divide = function(out, a, b) {
      out[0] = a[0] / b[0];
      out[1] = a[1] / b[1];
      return out;
    };
    vec2.div = vec2.divide;
    vec2.min = function(out, a, b) {
      out[0] = Math.min(a[0], b[0]);
      out[1] = Math.min(a[1], b[1]);
      return out;
    };
    vec2.max = function(out, a, b) {
      out[0] = Math.max(a[0], b[0]);
      out[1] = Math.max(a[1], b[1]);
      return out;
    };
    vec2.scale = function(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      return out;
    };
    vec2.scaleAndAdd = function(out, a, b, scale) {
      out[0] = a[0] + (b[0] * scale);
      out[1] = a[1] + (b[1] * scale);
      return out;
    };
    vec2.distance = function(a, b) {
      var x = b[0] - a[0],
          y = b[1] - a[1];
      return Math.sqrt(x * x + y * y);
    };
    vec2.dist = vec2.distance;
    vec2.squaredDistance = function(a, b) {
      var x = b[0] - a[0],
          y = b[1] - a[1];
      return x * x + y * y;
    };
    vec2.sqrDist = vec2.squaredDistance;
    vec2.length = function(a) {
      var x = a[0],
          y = a[1];
      return Math.sqrt(x * x + y * y);
    };
    vec2.len = vec2.length;
    vec2.squaredLength = function(a) {
      var x = a[0],
          y = a[1];
      return x * x + y * y;
    };
    vec2.sqrLen = vec2.squaredLength;
    vec2.negate = function(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      return out;
    };
    vec2.inverse = function(out, a) {
      out[0] = 1.0 / a[0];
      out[1] = 1.0 / a[1];
      return out;
    };
    vec2.normalize = function(out, a) {
      var x = a[0],
          y = a[1];
      var len = x * x + y * y;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
      }
      return out;
    };
    vec2.dot = function(a, b) {
      return a[0] * b[0] + a[1] * b[1];
    };
    vec2.cross = function(out, a, b) {
      var z = a[0] * b[1] - a[1] * b[0];
      out[0] = out[1] = 0;
      out[2] = z;
      return out;
    };
    vec2.lerp = function(out, a, b, t) {
      var ax = a[0],
          ay = a[1];
      out[0] = ax + t * (b[0] - ax);
      out[1] = ay + t * (b[1] - ay);
      return out;
    };
    vec2.random = function(out, scale) {
      scale = scale || 1.0;
      var r = GLMAT_RANDOM() * 2.0 * Math.PI;
      out[0] = Math.cos(r) * scale;
      out[1] = Math.sin(r) * scale;
      return out;
    };
    vec2.transformMat2 = function(out, a, m) {
      var x = a[0],
          y = a[1];
      out[0] = m[0] * x + m[2] * y;
      out[1] = m[1] * x + m[3] * y;
      return out;
    };
    vec2.transformMat2d = function(out, a, m) {
      var x = a[0],
          y = a[1];
      out[0] = m[0] * x + m[2] * y + m[4];
      out[1] = m[1] * x + m[3] * y + m[5];
      return out;
    };
    vec2.transformMat3 = function(out, a, m) {
      var x = a[0],
          y = a[1];
      out[0] = m[0] * x + m[3] * y + m[6];
      out[1] = m[1] * x + m[4] * y + m[7];
      return out;
    };
    vec2.transformMat4 = function(out, a, m) {
      var x = a[0],
          y = a[1];
      out[0] = m[0] * x + m[4] * y + m[12];
      out[1] = m[1] * x + m[5] * y + m[13];
      return out;
    };
    vec2.forEach = (function() {
      var vec = vec2.create();
      return function(a, stride, offset, count, fn, arg) {
        var i,
            l;
        if (!stride) {
          stride = 2;
        }
        if (!offset) {
          offset = 0;
        }
        if (count) {
          l = Math.min((count * stride) + offset, a.length);
        } else {
          l = a.length;
        }
        for (i = offset; i < l; i += stride) {
          vec[0] = a[i];
          vec[1] = a[i + 1];
          fn(vec, vec, arg);
          a[i] = vec[0];
          a[i + 1] = vec[1];
        }
        return a;
      };
    })();
    vec2.str = function(a) {
      return 'vec2(' + a[0] + ', ' + a[1] + ')';
    };
    if (typeof(exports) !== 'undefined') {
      exports.vec2 = vec2;
    }
    ;
    var vec3 = {};
    vec3.create = function() {
      var out = new GLMAT_ARRAY_TYPE(3);
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return out;
    };
    vec3.clone = function(a) {
      var out = new GLMAT_ARRAY_TYPE(3);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      return out;
    };
    vec3.fromValues = function(x, y, z) {
      var out = new GLMAT_ARRAY_TYPE(3);
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return out;
    };
    vec3.copy = function(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      return out;
    };
    vec3.set = function(out, x, y, z) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return out;
    };
    vec3.add = function(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      return out;
    };
    vec3.subtract = function(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      return out;
    };
    vec3.sub = vec3.subtract;
    vec3.multiply = function(out, a, b) {
      out[0] = a[0] * b[0];
      out[1] = a[1] * b[1];
      out[2] = a[2] * b[2];
      return out;
    };
    vec3.mul = vec3.multiply;
    vec3.divide = function(out, a, b) {
      out[0] = a[0] / b[0];
      out[1] = a[1] / b[1];
      out[2] = a[2] / b[2];
      return out;
    };
    vec3.div = vec3.divide;
    vec3.min = function(out, a, b) {
      out[0] = Math.min(a[0], b[0]);
      out[1] = Math.min(a[1], b[1]);
      out[2] = Math.min(a[2], b[2]);
      return out;
    };
    vec3.max = function(out, a, b) {
      out[0] = Math.max(a[0], b[0]);
      out[1] = Math.max(a[1], b[1]);
      out[2] = Math.max(a[2], b[2]);
      return out;
    };
    vec3.scale = function(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      return out;
    };
    vec3.scaleAndAdd = function(out, a, b, scale) {
      out[0] = a[0] + (b[0] * scale);
      out[1] = a[1] + (b[1] * scale);
      out[2] = a[2] + (b[2] * scale);
      return out;
    };
    vec3.distance = function(a, b) {
      var x = b[0] - a[0],
          y = b[1] - a[1],
          z = b[2] - a[2];
      return Math.sqrt(x * x + y * y + z * z);
    };
    vec3.dist = vec3.distance;
    vec3.squaredDistance = function(a, b) {
      var x = b[0] - a[0],
          y = b[1] - a[1],
          z = b[2] - a[2];
      return x * x + y * y + z * z;
    };
    vec3.sqrDist = vec3.squaredDistance;
    vec3.length = function(a) {
      var x = a[0],
          y = a[1],
          z = a[2];
      return Math.sqrt(x * x + y * y + z * z);
    };
    vec3.len = vec3.length;
    vec3.squaredLength = function(a) {
      var x = a[0],
          y = a[1],
          z = a[2];
      return x * x + y * y + z * z;
    };
    vec3.sqrLen = vec3.squaredLength;
    vec3.negate = function(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      return out;
    };
    vec3.inverse = function(out, a) {
      out[0] = 1.0 / a[0];
      out[1] = 1.0 / a[1];
      out[2] = 1.0 / a[2];
      return out;
    };
    vec3.normalize = function(out, a) {
      var x = a[0],
          y = a[1],
          z = a[2];
      var len = x * x + y * y + z * z;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
        out[2] = a[2] * len;
      }
      return out;
    };
    vec3.dot = function(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    };
    vec3.cross = function(out, a, b) {
      var ax = a[0],
          ay = a[1],
          az = a[2],
          bx = b[0],
          by = b[1],
          bz = b[2];
      out[0] = ay * bz - az * by;
      out[1] = az * bx - ax * bz;
      out[2] = ax * by - ay * bx;
      return out;
    };
    vec3.lerp = function(out, a, b, t) {
      var ax = a[0],
          ay = a[1],
          az = a[2];
      out[0] = ax + t * (b[0] - ax);
      out[1] = ay + t * (b[1] - ay);
      out[2] = az + t * (b[2] - az);
      return out;
    };
    vec3.random = function(out, scale) {
      scale = scale || 1.0;
      var r = GLMAT_RANDOM() * 2.0 * Math.PI;
      var z = (GLMAT_RANDOM() * 2.0) - 1.0;
      var zScale = Math.sqrt(1.0 - z * z) * scale;
      out[0] = Math.cos(r) * zScale;
      out[1] = Math.sin(r) * zScale;
      out[2] = z * scale;
      return out;
    };
    vec3.transformMat4 = function(out, a, m) {
      var x = a[0],
          y = a[1],
          z = a[2],
          w = m[3] * x + m[7] * y + m[11] * z + m[15];
      w = w || 1.0;
      out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      return out;
    };
    vec3.transformMat3 = function(out, a, m) {
      var x = a[0],
          y = a[1],
          z = a[2];
      out[0] = x * m[0] + y * m[3] + z * m[6];
      out[1] = x * m[1] + y * m[4] + z * m[7];
      out[2] = x * m[2] + y * m[5] + z * m[8];
      return out;
    };
    vec3.transformQuat = function(out, a, q) {
      var x = a[0],
          y = a[1],
          z = a[2],
          qx = q[0],
          qy = q[1],
          qz = q[2],
          qw = q[3],
          ix = qw * x + qy * z - qz * y,
          iy = qw * y + qz * x - qx * z,
          iz = qw * z + qx * y - qy * x,
          iw = -qx * x - qy * y - qz * z;
      out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
      out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
      out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
      return out;
    };
    vec3.rotateX = function(out, a, b, c) {
      var p = [],
          r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[0];
      r[1] = p[1] * Math.cos(c) - p[2] * Math.sin(c);
      r[2] = p[1] * Math.sin(c) + p[2] * Math.cos(c);
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    };
    vec3.rotateY = function(out, a, b, c) {
      var p = [],
          r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[2] * Math.sin(c) + p[0] * Math.cos(c);
      r[1] = p[1];
      r[2] = p[2] * Math.cos(c) - p[0] * Math.sin(c);
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    };
    vec3.rotateZ = function(out, a, b, c) {
      var p = [],
          r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[0] * Math.cos(c) - p[1] * Math.sin(c);
      r[1] = p[0] * Math.sin(c) + p[1] * Math.cos(c);
      r[2] = p[2];
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    };
    vec3.forEach = (function() {
      var vec = vec3.create();
      return function(a, stride, offset, count, fn, arg) {
        var i,
            l;
        if (!stride) {
          stride = 3;
        }
        if (!offset) {
          offset = 0;
        }
        if (count) {
          l = Math.min((count * stride) + offset, a.length);
        } else {
          l = a.length;
        }
        for (i = offset; i < l; i += stride) {
          vec[0] = a[i];
          vec[1] = a[i + 1];
          vec[2] = a[i + 2];
          fn(vec, vec, arg);
          a[i] = vec[0];
          a[i + 1] = vec[1];
          a[i + 2] = vec[2];
        }
        return a;
      };
    })();
    vec3.angle = function(a, b) {
      var tempA = vec3.fromValues(a[0], a[1], a[2]);
      var tempB = vec3.fromValues(b[0], b[1], b[2]);
      vec3.normalize(tempA, tempA);
      vec3.normalize(tempB, tempB);
      var cosine = vec3.dot(tempA, tempB);
      if (cosine > 1.0) {
        return 0;
      } else {
        return Math.acos(cosine);
      }
    };
    vec3.str = function(a) {
      return 'vec3(' + a[0] + ', ' + a[1] + ', ' + a[2] + ')';
    };
    if (typeof(exports) !== 'undefined') {
      exports.vec3 = vec3;
    }
    ;
    var vec4 = {};
    vec4.create = function() {
      var out = new GLMAT_ARRAY_TYPE(4);
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      return out;
    };
    vec4.clone = function(a) {
      var out = new GLMAT_ARRAY_TYPE(4);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    };
    vec4.fromValues = function(x, y, z, w) {
      var out = new GLMAT_ARRAY_TYPE(4);
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = w;
      return out;
    };
    vec4.copy = function(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    };
    vec4.set = function(out, x, y, z, w) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = w;
      return out;
    };
    vec4.add = function(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      return out;
    };
    vec4.subtract = function(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      return out;
    };
    vec4.sub = vec4.subtract;
    vec4.multiply = function(out, a, b) {
      out[0] = a[0] * b[0];
      out[1] = a[1] * b[1];
      out[2] = a[2] * b[2];
      out[3] = a[3] * b[3];
      return out;
    };
    vec4.mul = vec4.multiply;
    vec4.divide = function(out, a, b) {
      out[0] = a[0] / b[0];
      out[1] = a[1] / b[1];
      out[2] = a[2] / b[2];
      out[3] = a[3] / b[3];
      return out;
    };
    vec4.div = vec4.divide;
    vec4.min = function(out, a, b) {
      out[0] = Math.min(a[0], b[0]);
      out[1] = Math.min(a[1], b[1]);
      out[2] = Math.min(a[2], b[2]);
      out[3] = Math.min(a[3], b[3]);
      return out;
    };
    vec4.max = function(out, a, b) {
      out[0] = Math.max(a[0], b[0]);
      out[1] = Math.max(a[1], b[1]);
      out[2] = Math.max(a[2], b[2]);
      out[3] = Math.max(a[3], b[3]);
      return out;
    };
    vec4.scale = function(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      return out;
    };
    vec4.scaleAndAdd = function(out, a, b, scale) {
      out[0] = a[0] + (b[0] * scale);
      out[1] = a[1] + (b[1] * scale);
      out[2] = a[2] + (b[2] * scale);
      out[3] = a[3] + (b[3] * scale);
      return out;
    };
    vec4.distance = function(a, b) {
      var x = b[0] - a[0],
          y = b[1] - a[1],
          z = b[2] - a[2],
          w = b[3] - a[3];
      return Math.sqrt(x * x + y * y + z * z + w * w);
    };
    vec4.dist = vec4.distance;
    vec4.squaredDistance = function(a, b) {
      var x = b[0] - a[0],
          y = b[1] - a[1],
          z = b[2] - a[2],
          w = b[3] - a[3];
      return x * x + y * y + z * z + w * w;
    };
    vec4.sqrDist = vec4.squaredDistance;
    vec4.length = function(a) {
      var x = a[0],
          y = a[1],
          z = a[2],
          w = a[3];
      return Math.sqrt(x * x + y * y + z * z + w * w);
    };
    vec4.len = vec4.length;
    vec4.squaredLength = function(a) {
      var x = a[0],
          y = a[1],
          z = a[2],
          w = a[3];
      return x * x + y * y + z * z + w * w;
    };
    vec4.sqrLen = vec4.squaredLength;
    vec4.negate = function(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = -a[3];
      return out;
    };
    vec4.inverse = function(out, a) {
      out[0] = 1.0 / a[0];
      out[1] = 1.0 / a[1];
      out[2] = 1.0 / a[2];
      out[3] = 1.0 / a[3];
      return out;
    };
    vec4.normalize = function(out, a) {
      var x = a[0],
          y = a[1],
          z = a[2],
          w = a[3];
      var len = x * x + y * y + z * z + w * w;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
        out[2] = a[2] * len;
        out[3] = a[3] * len;
      }
      return out;
    };
    vec4.dot = function(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    };
    vec4.lerp = function(out, a, b, t) {
      var ax = a[0],
          ay = a[1],
          az = a[2],
          aw = a[3];
      out[0] = ax + t * (b[0] - ax);
      out[1] = ay + t * (b[1] - ay);
      out[2] = az + t * (b[2] - az);
      out[3] = aw + t * (b[3] - aw);
      return out;
    };
    vec4.random = function(out, scale) {
      scale = scale || 1.0;
      out[0] = GLMAT_RANDOM();
      out[1] = GLMAT_RANDOM();
      out[2] = GLMAT_RANDOM();
      out[3] = GLMAT_RANDOM();
      vec4.normalize(out, out);
      vec4.scale(out, out, scale);
      return out;
    };
    vec4.transformMat4 = function(out, a, m) {
      var x = a[0],
          y = a[1],
          z = a[2],
          w = a[3];
      out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
      out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
      out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
      out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
      return out;
    };
    vec4.transformQuat = function(out, a, q) {
      var x = a[0],
          y = a[1],
          z = a[2],
          qx = q[0],
          qy = q[1],
          qz = q[2],
          qw = q[3],
          ix = qw * x + qy * z - qz * y,
          iy = qw * y + qz * x - qx * z,
          iz = qw * z + qx * y - qy * x,
          iw = -qx * x - qy * y - qz * z;
      out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
      out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
      out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
      return out;
    };
    vec4.forEach = (function() {
      var vec = vec4.create();
      return function(a, stride, offset, count, fn, arg) {
        var i,
            l;
        if (!stride) {
          stride = 4;
        }
        if (!offset) {
          offset = 0;
        }
        if (count) {
          l = Math.min((count * stride) + offset, a.length);
        } else {
          l = a.length;
        }
        for (i = offset; i < l; i += stride) {
          vec[0] = a[i];
          vec[1] = a[i + 1];
          vec[2] = a[i + 2];
          vec[3] = a[i + 3];
          fn(vec, vec, arg);
          a[i] = vec[0];
          a[i + 1] = vec[1];
          a[i + 2] = vec[2];
          a[i + 3] = vec[3];
        }
        return a;
      };
    })();
    vec4.str = function(a) {
      return 'vec4(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ')';
    };
    if (typeof(exports) !== 'undefined') {
      exports.vec4 = vec4;
    }
    ;
    var mat2 = {};
    mat2.create = function() {
      var out = new GLMAT_ARRAY_TYPE(4);
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    };
    mat2.clone = function(a) {
      var out = new GLMAT_ARRAY_TYPE(4);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    };
    mat2.copy = function(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    };
    mat2.identity = function(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    };
    mat2.transpose = function(out, a) {
      if (out === a) {
        var a1 = a[1];
        out[1] = a[2];
        out[2] = a1;
      } else {
        out[0] = a[0];
        out[1] = a[2];
        out[2] = a[1];
        out[3] = a[3];
      }
      return out;
    };
    mat2.invert = function(out, a) {
      var a0 = a[0],
          a1 = a[1],
          a2 = a[2],
          a3 = a[3],
          det = a0 * a3 - a2 * a1;
      if (!det) {
        return null;
      }
      det = 1.0 / det;
      out[0] = a3 * det;
      out[1] = -a1 * det;
      out[2] = -a2 * det;
      out[3] = a0 * det;
      return out;
    };
    mat2.adjoint = function(out, a) {
      var a0 = a[0];
      out[0] = a[3];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = a0;
      return out;
    };
    mat2.determinant = function(a) {
      return a[0] * a[3] - a[2] * a[1];
    };
    mat2.multiply = function(out, a, b) {
      var a0 = a[0],
          a1 = a[1],
          a2 = a[2],
          a3 = a[3];
      var b0 = b[0],
          b1 = b[1],
          b2 = b[2],
          b3 = b[3];
      out[0] = a0 * b0 + a2 * b1;
      out[1] = a1 * b0 + a3 * b1;
      out[2] = a0 * b2 + a2 * b3;
      out[3] = a1 * b2 + a3 * b3;
      return out;
    };
    mat2.mul = mat2.multiply;
    mat2.rotate = function(out, a, rad) {
      var a0 = a[0],
          a1 = a[1],
          a2 = a[2],
          a3 = a[3],
          s = Math.sin(rad),
          c = Math.cos(rad);
      out[0] = a0 * c + a2 * s;
      out[1] = a1 * c + a3 * s;
      out[2] = a0 * -s + a2 * c;
      out[3] = a1 * -s + a3 * c;
      return out;
    };
    mat2.scale = function(out, a, v) {
      var a0 = a[0],
          a1 = a[1],
          a2 = a[2],
          a3 = a[3],
          v0 = v[0],
          v1 = v[1];
      out[0] = a0 * v0;
      out[1] = a1 * v0;
      out[2] = a2 * v1;
      out[3] = a3 * v1;
      return out;
    };
    mat2.str = function(a) {
      return 'mat2(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ')';
    };
    mat2.frob = function(a) {
      return (Math.sqrt(Math.pow(a[0], 2) + Math.pow(a[1], 2) + Math.pow(a[2], 2) + Math.pow(a[3], 2)));
    };
    mat2.LDU = function(L, D, U, a) {
      L[2] = a[2] / a[0];
      U[0] = a[0];
      U[1] = a[1];
      U[3] = a[3] - L[2] * U[1];
      return [L, D, U];
    };
    if (typeof(exports) !== 'undefined') {
      exports.mat2 = mat2;
    }
    ;
    var mat2d = {};
    mat2d.create = function() {
      var out = new GLMAT_ARRAY_TYPE(6);
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = 0;
      out[5] = 0;
      return out;
    };
    mat2d.clone = function(a) {
      var out = new GLMAT_ARRAY_TYPE(6);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      return out;
    };
    mat2d.copy = function(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      return out;
    };
    mat2d.identity = function(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = 0;
      out[5] = 0;
      return out;
    };
    mat2d.invert = function(out, a) {
      var aa = a[0],
          ab = a[1],
          ac = a[2],
          ad = a[3],
          atx = a[4],
          aty = a[5];
      var det = aa * ad - ab * ac;
      if (!det) {
        return null;
      }
      det = 1.0 / det;
      out[0] = ad * det;
      out[1] = -ab * det;
      out[2] = -ac * det;
      out[3] = aa * det;
      out[4] = (ac * aty - ad * atx) * det;
      out[5] = (ab * atx - aa * aty) * det;
      return out;
    };
    mat2d.determinant = function(a) {
      return a[0] * a[3] - a[1] * a[2];
    };
    mat2d.multiply = function(out, a, b) {
      var a0 = a[0],
          a1 = a[1],
          a2 = a[2],
          a3 = a[3],
          a4 = a[4],
          a5 = a[5],
          b0 = b[0],
          b1 = b[1],
          b2 = b[2],
          b3 = b[3],
          b4 = b[4],
          b5 = b[5];
      out[0] = a0 * b0 + a2 * b1;
      out[1] = a1 * b0 + a3 * b1;
      out[2] = a0 * b2 + a2 * b3;
      out[3] = a1 * b2 + a3 * b3;
      out[4] = a0 * b4 + a2 * b5 + a4;
      out[5] = a1 * b4 + a3 * b5 + a5;
      return out;
    };
    mat2d.mul = mat2d.multiply;
    mat2d.rotate = function(out, a, rad) {
      var a0 = a[0],
          a1 = a[1],
          a2 = a[2],
          a3 = a[3],
          a4 = a[4],
          a5 = a[5],
          s = Math.sin(rad),
          c = Math.cos(rad);
      out[0] = a0 * c + a2 * s;
      out[1] = a1 * c + a3 * s;
      out[2] = a0 * -s + a2 * c;
      out[3] = a1 * -s + a3 * c;
      out[4] = a4;
      out[5] = a5;
      return out;
    };
    mat2d.scale = function(out, a, v) {
      var a0 = a[0],
          a1 = a[1],
          a2 = a[2],
          a3 = a[3],
          a4 = a[4],
          a5 = a[5],
          v0 = v[0],
          v1 = v[1];
      out[0] = a0 * v0;
      out[1] = a1 * v0;
      out[2] = a2 * v1;
      out[3] = a3 * v1;
      out[4] = a4;
      out[5] = a5;
      return out;
    };
    mat2d.translate = function(out, a, v) {
      var a0 = a[0],
          a1 = a[1],
          a2 = a[2],
          a3 = a[3],
          a4 = a[4],
          a5 = a[5],
          v0 = v[0],
          v1 = v[1];
      out[0] = a0;
      out[1] = a1;
      out[2] = a2;
      out[3] = a3;
      out[4] = a0 * v0 + a2 * v1 + a4;
      out[5] = a1 * v0 + a3 * v1 + a5;
      return out;
    };
    mat2d.str = function(a) {
      return 'mat2d(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ', ' + a[4] + ', ' + a[5] + ')';
    };
    mat2d.frob = function(a) {
      return (Math.sqrt(Math.pow(a[0], 2) + Math.pow(a[1], 2) + Math.pow(a[2], 2) + Math.pow(a[3], 2) + Math.pow(a[4], 2) + Math.pow(a[5], 2) + 1));
    };
    if (typeof(exports) !== 'undefined') {
      exports.mat2d = mat2d;
    }
    ;
    var mat3 = {};
    mat3.create = function() {
      var out = new GLMAT_ARRAY_TYPE(9);
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 1;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
    };
    mat3.fromMat4 = function(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[4];
      out[4] = a[5];
      out[5] = a[6];
      out[6] = a[8];
      out[7] = a[9];
      out[8] = a[10];
      return out;
    };
    mat3.clone = function(a) {
      var out = new GLMAT_ARRAY_TYPE(9);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      return out;
    };
    mat3.copy = function(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      return out;
    };
    mat3.identity = function(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 1;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
    };
    mat3.transpose = function(out, a) {
      if (out === a) {
        var a01 = a[1],
            a02 = a[2],
            a12 = a[5];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a01;
        out[5] = a[7];
        out[6] = a02;
        out[7] = a12;
      } else {
        out[0] = a[0];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a[1];
        out[4] = a[4];
        out[5] = a[7];
        out[6] = a[2];
        out[7] = a[5];
        out[8] = a[8];
      }
      return out;
    };
    mat3.invert = function(out, a) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a10 = a[3],
          a11 = a[4],
          a12 = a[5],
          a20 = a[6],
          a21 = a[7],
          a22 = a[8],
          b01 = a22 * a11 - a12 * a21,
          b11 = -a22 * a10 + a12 * a20,
          b21 = a21 * a10 - a11 * a20,
          det = a00 * b01 + a01 * b11 + a02 * b21;
      if (!det) {
        return null;
      }
      det = 1.0 / det;
      out[0] = b01 * det;
      out[1] = (-a22 * a01 + a02 * a21) * det;
      out[2] = (a12 * a01 - a02 * a11) * det;
      out[3] = b11 * det;
      out[4] = (a22 * a00 - a02 * a20) * det;
      out[5] = (-a12 * a00 + a02 * a10) * det;
      out[6] = b21 * det;
      out[7] = (-a21 * a00 + a01 * a20) * det;
      out[8] = (a11 * a00 - a01 * a10) * det;
      return out;
    };
    mat3.adjoint = function(out, a) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a10 = a[3],
          a11 = a[4],
          a12 = a[5],
          a20 = a[6],
          a21 = a[7],
          a22 = a[8];
      out[0] = (a11 * a22 - a12 * a21);
      out[1] = (a02 * a21 - a01 * a22);
      out[2] = (a01 * a12 - a02 * a11);
      out[3] = (a12 * a20 - a10 * a22);
      out[4] = (a00 * a22 - a02 * a20);
      out[5] = (a02 * a10 - a00 * a12);
      out[6] = (a10 * a21 - a11 * a20);
      out[7] = (a01 * a20 - a00 * a21);
      out[8] = (a00 * a11 - a01 * a10);
      return out;
    };
    mat3.determinant = function(a) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a10 = a[3],
          a11 = a[4],
          a12 = a[5],
          a20 = a[6],
          a21 = a[7],
          a22 = a[8];
      return a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20);
    };
    mat3.multiply = function(out, a, b) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a10 = a[3],
          a11 = a[4],
          a12 = a[5],
          a20 = a[6],
          a21 = a[7],
          a22 = a[8],
          b00 = b[0],
          b01 = b[1],
          b02 = b[2],
          b10 = b[3],
          b11 = b[4],
          b12 = b[5],
          b20 = b[6],
          b21 = b[7],
          b22 = b[8];
      out[0] = b00 * a00 + b01 * a10 + b02 * a20;
      out[1] = b00 * a01 + b01 * a11 + b02 * a21;
      out[2] = b00 * a02 + b01 * a12 + b02 * a22;
      out[3] = b10 * a00 + b11 * a10 + b12 * a20;
      out[4] = b10 * a01 + b11 * a11 + b12 * a21;
      out[5] = b10 * a02 + b11 * a12 + b12 * a22;
      out[6] = b20 * a00 + b21 * a10 + b22 * a20;
      out[7] = b20 * a01 + b21 * a11 + b22 * a21;
      out[8] = b20 * a02 + b21 * a12 + b22 * a22;
      return out;
    };
    mat3.mul = mat3.multiply;
    mat3.translate = function(out, a, v) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a10 = a[3],
          a11 = a[4],
          a12 = a[5],
          a20 = a[6],
          a21 = a[7],
          a22 = a[8],
          x = v[0],
          y = v[1];
      out[0] = a00;
      out[1] = a01;
      out[2] = a02;
      out[3] = a10;
      out[4] = a11;
      out[5] = a12;
      out[6] = x * a00 + y * a10 + a20;
      out[7] = x * a01 + y * a11 + a21;
      out[8] = x * a02 + y * a12 + a22;
      return out;
    };
    mat3.rotate = function(out, a, rad) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a10 = a[3],
          a11 = a[4],
          a12 = a[5],
          a20 = a[6],
          a21 = a[7],
          a22 = a[8],
          s = Math.sin(rad),
          c = Math.cos(rad);
      out[0] = c * a00 + s * a10;
      out[1] = c * a01 + s * a11;
      out[2] = c * a02 + s * a12;
      out[3] = c * a10 - s * a00;
      out[4] = c * a11 - s * a01;
      out[5] = c * a12 - s * a02;
      out[6] = a20;
      out[7] = a21;
      out[8] = a22;
      return out;
    };
    mat3.scale = function(out, a, v) {
      var x = v[0],
          y = v[1];
      out[0] = x * a[0];
      out[1] = x * a[1];
      out[2] = x * a[2];
      out[3] = y * a[3];
      out[4] = y * a[4];
      out[5] = y * a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      return out;
    };
    mat3.fromMat2d = function(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = 0;
      out[3] = a[2];
      out[4] = a[3];
      out[5] = 0;
      out[6] = a[4];
      out[7] = a[5];
      out[8] = 1;
      return out;
    };
    mat3.fromQuat = function(out, q) {
      var x = q[0],
          y = q[1],
          z = q[2],
          w = q[3],
          x2 = x + x,
          y2 = y + y,
          z2 = z + z,
          xx = x * x2,
          yx = y * x2,
          yy = y * y2,
          zx = z * x2,
          zy = z * y2,
          zz = z * z2,
          wx = w * x2,
          wy = w * y2,
          wz = w * z2;
      out[0] = 1 - yy - zz;
      out[3] = yx - wz;
      out[6] = zx + wy;
      out[1] = yx + wz;
      out[4] = 1 - xx - zz;
      out[7] = zy - wx;
      out[2] = zx - wy;
      out[5] = zy + wx;
      out[8] = 1 - xx - yy;
      return out;
    };
    mat3.normalFromMat4 = function(out, a) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a03 = a[3],
          a10 = a[4],
          a11 = a[5],
          a12 = a[6],
          a13 = a[7],
          a20 = a[8],
          a21 = a[9],
          a22 = a[10],
          a23 = a[11],
          a30 = a[12],
          a31 = a[13],
          a32 = a[14],
          a33 = a[15],
          b00 = a00 * a11 - a01 * a10,
          b01 = a00 * a12 - a02 * a10,
          b02 = a00 * a13 - a03 * a10,
          b03 = a01 * a12 - a02 * a11,
          b04 = a01 * a13 - a03 * a11,
          b05 = a02 * a13 - a03 * a12,
          b06 = a20 * a31 - a21 * a30,
          b07 = a20 * a32 - a22 * a30,
          b08 = a20 * a33 - a23 * a30,
          b09 = a21 * a32 - a22 * a31,
          b10 = a21 * a33 - a23 * a31,
          b11 = a22 * a33 - a23 * a32,
          det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) {
        return null;
      }
      det = 1.0 / det;
      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[2] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[3] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[4] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[5] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[6] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[7] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[8] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      return out;
    };
    mat3.str = function(a) {
      return 'mat3(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ', ' + a[4] + ', ' + a[5] + ', ' + a[6] + ', ' + a[7] + ', ' + a[8] + ')';
    };
    mat3.frob = function(a) {
      return (Math.sqrt(Math.pow(a[0], 2) + Math.pow(a[1], 2) + Math.pow(a[2], 2) + Math.pow(a[3], 2) + Math.pow(a[4], 2) + Math.pow(a[5], 2) + Math.pow(a[6], 2) + Math.pow(a[7], 2) + Math.pow(a[8], 2)));
    };
    if (typeof(exports) !== 'undefined') {
      exports.mat3 = mat3;
    }
    ;
    var mat4 = {};
    mat4.create = function() {
      var out = new GLMAT_ARRAY_TYPE(16);
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = 1;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 1;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    };
    mat4.clone = function(a) {
      var out = new GLMAT_ARRAY_TYPE(16);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      out[9] = a[9];
      out[10] = a[10];
      out[11] = a[11];
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
      return out;
    };
    mat4.copy = function(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      out[9] = a[9];
      out[10] = a[10];
      out[11] = a[11];
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
      return out;
    };
    mat4.identity = function(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = 1;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 1;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    };
    mat4.transpose = function(out, a) {
      if (out === a) {
        var a01 = a[1],
            a02 = a[2],
            a03 = a[3],
            a12 = a[6],
            a13 = a[7],
            a23 = a[11];
        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a01;
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a02;
        out[9] = a12;
        out[11] = a[14];
        out[12] = a03;
        out[13] = a13;
        out[14] = a23;
      } else {
        out[0] = a[0];
        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a[1];
        out[5] = a[5];
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a[2];
        out[9] = a[6];
        out[10] = a[10];
        out[11] = a[14];
        out[12] = a[3];
        out[13] = a[7];
        out[14] = a[11];
        out[15] = a[15];
      }
      return out;
    };
    mat4.invert = function(out, a) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a03 = a[3],
          a10 = a[4],
          a11 = a[5],
          a12 = a[6],
          a13 = a[7],
          a20 = a[8],
          a21 = a[9],
          a22 = a[10],
          a23 = a[11],
          a30 = a[12],
          a31 = a[13],
          a32 = a[14],
          a33 = a[15],
          b00 = a00 * a11 - a01 * a10,
          b01 = a00 * a12 - a02 * a10,
          b02 = a00 * a13 - a03 * a10,
          b03 = a01 * a12 - a02 * a11,
          b04 = a01 * a13 - a03 * a11,
          b05 = a02 * a13 - a03 * a12,
          b06 = a20 * a31 - a21 * a30,
          b07 = a20 * a32 - a22 * a30,
          b08 = a20 * a33 - a23 * a30,
          b09 = a21 * a32 - a22 * a31,
          b10 = a21 * a33 - a23 * a31,
          b11 = a22 * a33 - a23 * a32,
          det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) {
        return null;
      }
      det = 1.0 / det;
      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return out;
    };
    mat4.adjoint = function(out, a) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a03 = a[3],
          a10 = a[4],
          a11 = a[5],
          a12 = a[6],
          a13 = a[7],
          a20 = a[8],
          a21 = a[9],
          a22 = a[10],
          a23 = a[11],
          a30 = a[12],
          a31 = a[13],
          a32 = a[14],
          a33 = a[15];
      out[0] = (a11 * (a22 * a33 - a23 * a32) - a21 * (a12 * a33 - a13 * a32) + a31 * (a12 * a23 - a13 * a22));
      out[1] = -(a01 * (a22 * a33 - a23 * a32) - a21 * (a02 * a33 - a03 * a32) + a31 * (a02 * a23 - a03 * a22));
      out[2] = (a01 * (a12 * a33 - a13 * a32) - a11 * (a02 * a33 - a03 * a32) + a31 * (a02 * a13 - a03 * a12));
      out[3] = -(a01 * (a12 * a23 - a13 * a22) - a11 * (a02 * a23 - a03 * a22) + a21 * (a02 * a13 - a03 * a12));
      out[4] = -(a10 * (a22 * a33 - a23 * a32) - a20 * (a12 * a33 - a13 * a32) + a30 * (a12 * a23 - a13 * a22));
      out[5] = (a00 * (a22 * a33 - a23 * a32) - a20 * (a02 * a33 - a03 * a32) + a30 * (a02 * a23 - a03 * a22));
      out[6] = -(a00 * (a12 * a33 - a13 * a32) - a10 * (a02 * a33 - a03 * a32) + a30 * (a02 * a13 - a03 * a12));
      out[7] = (a00 * (a12 * a23 - a13 * a22) - a10 * (a02 * a23 - a03 * a22) + a20 * (a02 * a13 - a03 * a12));
      out[8] = (a10 * (a21 * a33 - a23 * a31) - a20 * (a11 * a33 - a13 * a31) + a30 * (a11 * a23 - a13 * a21));
      out[9] = -(a00 * (a21 * a33 - a23 * a31) - a20 * (a01 * a33 - a03 * a31) + a30 * (a01 * a23 - a03 * a21));
      out[10] = (a00 * (a11 * a33 - a13 * a31) - a10 * (a01 * a33 - a03 * a31) + a30 * (a01 * a13 - a03 * a11));
      out[11] = -(a00 * (a11 * a23 - a13 * a21) - a10 * (a01 * a23 - a03 * a21) + a20 * (a01 * a13 - a03 * a11));
      out[12] = -(a10 * (a21 * a32 - a22 * a31) - a20 * (a11 * a32 - a12 * a31) + a30 * (a11 * a22 - a12 * a21));
      out[13] = (a00 * (a21 * a32 - a22 * a31) - a20 * (a01 * a32 - a02 * a31) + a30 * (a01 * a22 - a02 * a21));
      out[14] = -(a00 * (a11 * a32 - a12 * a31) - a10 * (a01 * a32 - a02 * a31) + a30 * (a01 * a12 - a02 * a11));
      out[15] = (a00 * (a11 * a22 - a12 * a21) - a10 * (a01 * a22 - a02 * a21) + a20 * (a01 * a12 - a02 * a11));
      return out;
    };
    mat4.determinant = function(a) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a03 = a[3],
          a10 = a[4],
          a11 = a[5],
          a12 = a[6],
          a13 = a[7],
          a20 = a[8],
          a21 = a[9],
          a22 = a[10],
          a23 = a[11],
          a30 = a[12],
          a31 = a[13],
          a32 = a[14],
          a33 = a[15],
          b00 = a00 * a11 - a01 * a10,
          b01 = a00 * a12 - a02 * a10,
          b02 = a00 * a13 - a03 * a10,
          b03 = a01 * a12 - a02 * a11,
          b04 = a01 * a13 - a03 * a11,
          b05 = a02 * a13 - a03 * a12,
          b06 = a20 * a31 - a21 * a30,
          b07 = a20 * a32 - a22 * a30,
          b08 = a20 * a33 - a23 * a30,
          b09 = a21 * a32 - a22 * a31,
          b10 = a21 * a33 - a23 * a31,
          b11 = a22 * a33 - a23 * a32;
      return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    };
    mat4.multiply = function(out, a, b) {
      var a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a03 = a[3],
          a10 = a[4],
          a11 = a[5],
          a12 = a[6],
          a13 = a[7],
          a20 = a[8],
          a21 = a[9],
          a22 = a[10],
          a23 = a[11],
          a30 = a[12],
          a31 = a[13],
          a32 = a[14],
          a33 = a[15];
      var b0 = b[0],
          b1 = b[1],
          b2 = b[2],
          b3 = b[3];
      out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[4];
      b1 = b[5];
      b2 = b[6];
      b3 = b[7];
      out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[8];
      b1 = b[9];
      b2 = b[10];
      b3 = b[11];
      out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[12];
      b1 = b[13];
      b2 = b[14];
      b3 = b[15];
      out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      return out;
    };
    mat4.mul = mat4.multiply;
    mat4.translate = function(out, a, v) {
      var x = v[0],
          y = v[1],
          z = v[2],
          a00,
          a01,
          a02,
          a03,
          a10,
          a11,
          a12,
          a13,
          a20,
          a21,
          a22,
          a23;
      if (a === out) {
        out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
        out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
        out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
        out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
      } else {
        a00 = a[0];
        a01 = a[1];
        a02 = a[2];
        a03 = a[3];
        a10 = a[4];
        a11 = a[5];
        a12 = a[6];
        a13 = a[7];
        a20 = a[8];
        a21 = a[9];
        a22 = a[10];
        a23 = a[11];
        out[0] = a00;
        out[1] = a01;
        out[2] = a02;
        out[3] = a03;
        out[4] = a10;
        out[5] = a11;
        out[6] = a12;
        out[7] = a13;
        out[8] = a20;
        out[9] = a21;
        out[10] = a22;
        out[11] = a23;
        out[12] = a00 * x + a10 * y + a20 * z + a[12];
        out[13] = a01 * x + a11 * y + a21 * z + a[13];
        out[14] = a02 * x + a12 * y + a22 * z + a[14];
        out[15] = a03 * x + a13 * y + a23 * z + a[15];
      }
      return out;
    };
    mat4.scale = function(out, a, v) {
      var x = v[0],
          y = v[1],
          z = v[2];
      out[0] = a[0] * x;
      out[1] = a[1] * x;
      out[2] = a[2] * x;
      out[3] = a[3] * x;
      out[4] = a[4] * y;
      out[5] = a[5] * y;
      out[6] = a[6] * y;
      out[7] = a[7] * y;
      out[8] = a[8] * z;
      out[9] = a[9] * z;
      out[10] = a[10] * z;
      out[11] = a[11] * z;
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
      return out;
    };
    mat4.rotate = function(out, a, rad, axis) {
      var x = axis[0],
          y = axis[1],
          z = axis[2],
          len = Math.sqrt(x * x + y * y + z * z),
          s,
          c,
          t,
          a00,
          a01,
          a02,
          a03,
          a10,
          a11,
          a12,
          a13,
          a20,
          a21,
          a22,
          a23,
          b00,
          b01,
          b02,
          b10,
          b11,
          b12,
          b20,
          b21,
          b22;
      if (Math.abs(len) < GLMAT_EPSILON) {
        return null;
      }
      len = 1 / len;
      x *= len;
      y *= len;
      z *= len;
      s = Math.sin(rad);
      c = Math.cos(rad);
      t = 1 - c;
      a00 = a[0];
      a01 = a[1];
      a02 = a[2];
      a03 = a[3];
      a10 = a[4];
      a11 = a[5];
      a12 = a[6];
      a13 = a[7];
      a20 = a[8];
      a21 = a[9];
      a22 = a[10];
      a23 = a[11];
      b00 = x * x * t + c;
      b01 = y * x * t + z * s;
      b02 = z * x * t - y * s;
      b10 = x * y * t - z * s;
      b11 = y * y * t + c;
      b12 = z * y * t + x * s;
      b20 = x * z * t + y * s;
      b21 = y * z * t - x * s;
      b22 = z * z * t + c;
      out[0] = a00 * b00 + a10 * b01 + a20 * b02;
      out[1] = a01 * b00 + a11 * b01 + a21 * b02;
      out[2] = a02 * b00 + a12 * b01 + a22 * b02;
      out[3] = a03 * b00 + a13 * b01 + a23 * b02;
      out[4] = a00 * b10 + a10 * b11 + a20 * b12;
      out[5] = a01 * b10 + a11 * b11 + a21 * b12;
      out[6] = a02 * b10 + a12 * b11 + a22 * b12;
      out[7] = a03 * b10 + a13 * b11 + a23 * b12;
      out[8] = a00 * b20 + a10 * b21 + a20 * b22;
      out[9] = a01 * b20 + a11 * b21 + a21 * b22;
      out[10] = a02 * b20 + a12 * b21 + a22 * b22;
      out[11] = a03 * b20 + a13 * b21 + a23 * b22;
      if (a !== out) {
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      return out;
    };
    mat4.rotateX = function(out, a, rad) {
      var s = Math.sin(rad),
          c = Math.cos(rad),
          a10 = a[4],
          a11 = a[5],
          a12 = a[6],
          a13 = a[7],
          a20 = a[8],
          a21 = a[9],
          a22 = a[10],
          a23 = a[11];
      if (a !== out) {
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        out[3] = a[3];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      out[4] = a10 * c + a20 * s;
      out[5] = a11 * c + a21 * s;
      out[6] = a12 * c + a22 * s;
      out[7] = a13 * c + a23 * s;
      out[8] = a20 * c - a10 * s;
      out[9] = a21 * c - a11 * s;
      out[10] = a22 * c - a12 * s;
      out[11] = a23 * c - a13 * s;
      return out;
    };
    mat4.rotateY = function(out, a, rad) {
      var s = Math.sin(rad),
          c = Math.cos(rad),
          a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a03 = a[3],
          a20 = a[8],
          a21 = a[9],
          a22 = a[10],
          a23 = a[11];
      if (a !== out) {
        out[4] = a[4];
        out[5] = a[5];
        out[6] = a[6];
        out[7] = a[7];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      out[0] = a00 * c - a20 * s;
      out[1] = a01 * c - a21 * s;
      out[2] = a02 * c - a22 * s;
      out[3] = a03 * c - a23 * s;
      out[8] = a00 * s + a20 * c;
      out[9] = a01 * s + a21 * c;
      out[10] = a02 * s + a22 * c;
      out[11] = a03 * s + a23 * c;
      return out;
    };
    mat4.rotateZ = function(out, a, rad) {
      var s = Math.sin(rad),
          c = Math.cos(rad),
          a00 = a[0],
          a01 = a[1],
          a02 = a[2],
          a03 = a[3],
          a10 = a[4],
          a11 = a[5],
          a12 = a[6],
          a13 = a[7];
      if (a !== out) {
        out[8] = a[8];
        out[9] = a[9];
        out[10] = a[10];
        out[11] = a[11];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      out[0] = a00 * c + a10 * s;
      out[1] = a01 * c + a11 * s;
      out[2] = a02 * c + a12 * s;
      out[3] = a03 * c + a13 * s;
      out[4] = a10 * c - a00 * s;
      out[5] = a11 * c - a01 * s;
      out[6] = a12 * c - a02 * s;
      out[7] = a13 * c - a03 * s;
      return out;
    };
    mat4.fromRotationTranslation = function(out, q, v) {
      var x = q[0],
          y = q[1],
          z = q[2],
          w = q[3],
          x2 = x + x,
          y2 = y + y,
          z2 = z + z,
          xx = x * x2,
          xy = x * y2,
          xz = x * z2,
          yy = y * y2,
          yz = y * z2,
          zz = z * z2,
          wx = w * x2,
          wy = w * y2,
          wz = w * z2;
      out[0] = 1 - (yy + zz);
      out[1] = xy + wz;
      out[2] = xz - wy;
      out[3] = 0;
      out[4] = xy - wz;
      out[5] = 1 - (xx + zz);
      out[6] = yz + wx;
      out[7] = 0;
      out[8] = xz + wy;
      out[9] = yz - wx;
      out[10] = 1 - (xx + yy);
      out[11] = 0;
      out[12] = v[0];
      out[13] = v[1];
      out[14] = v[2];
      out[15] = 1;
      return out;
    };
    mat4.fromQuat = function(out, q) {
      var x = q[0],
          y = q[1],
          z = q[2],
          w = q[3],
          x2 = x + x,
          y2 = y + y,
          z2 = z + z,
          xx = x * x2,
          yx = y * x2,
          yy = y * y2,
          zx = z * x2,
          zy = z * y2,
          zz = z * z2,
          wx = w * x2,
          wy = w * y2,
          wz = w * z2;
      out[0] = 1 - yy - zz;
      out[1] = yx + wz;
      out[2] = zx - wy;
      out[3] = 0;
      out[4] = yx - wz;
      out[5] = 1 - xx - zz;
      out[6] = zy + wx;
      out[7] = 0;
      out[8] = zx + wy;
      out[9] = zy - wx;
      out[10] = 1 - xx - yy;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    };
    mat4.frustum = function(out, left, right, bottom, top, near, far) {
      var rl = 1 / (right - left),
          tb = 1 / (top - bottom),
          nf = 1 / (near - far);
      out[0] = (near * 2) * rl;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = (near * 2) * tb;
      out[6] = 0;
      out[7] = 0;
      out[8] = (right + left) * rl;
      out[9] = (top + bottom) * tb;
      out[10] = (far + near) * nf;
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[14] = (far * near * 2) * nf;
      out[15] = 0;
      return out;
    };
    mat4.perspective = function(out, fovy, aspect, near, far) {
      var f = 1.0 / Math.tan(fovy / 2),
          nf = 1 / (near - far);
      out[0] = f / aspect;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = f;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = (far + near) * nf;
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[14] = (2 * far * near) * nf;
      out[15] = 0;
      return out;
    };
    mat4.ortho = function(out, left, right, bottom, top, near, far) {
      var lr = 1 / (left - right),
          bt = 1 / (bottom - top),
          nf = 1 / (near - far);
      out[0] = -2 * lr;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = -2 * bt;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 2 * nf;
      out[11] = 0;
      out[12] = (left + right) * lr;
      out[13] = (top + bottom) * bt;
      out[14] = (far + near) * nf;
      out[15] = 1;
      return out;
    };
    mat4.lookAt = function(out, eye, center, up) {
      var x0,
          x1,
          x2,
          y0,
          y1,
          y2,
          z0,
          z1,
          z2,
          len,
          eyex = eye[0],
          eyey = eye[1],
          eyez = eye[2],
          upx = up[0],
          upy = up[1],
          upz = up[2],
          centerx = center[0],
          centery = center[1],
          centerz = center[2];
      if (Math.abs(eyex - centerx) < GLMAT_EPSILON && Math.abs(eyey - centery) < GLMAT_EPSILON && Math.abs(eyez - centerz) < GLMAT_EPSILON) {
        return mat4.identity(out);
      }
      z0 = eyex - centerx;
      z1 = eyey - centery;
      z2 = eyez - centerz;
      len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
      z0 *= len;
      z1 *= len;
      z2 *= len;
      x0 = upy * z2 - upz * z1;
      x1 = upz * z0 - upx * z2;
      x2 = upx * z1 - upy * z0;
      len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
      if (!len) {
        x0 = 0;
        x1 = 0;
        x2 = 0;
      } else {
        len = 1 / len;
        x0 *= len;
        x1 *= len;
        x2 *= len;
      }
      y0 = z1 * x2 - z2 * x1;
      y1 = z2 * x0 - z0 * x2;
      y2 = z0 * x1 - z1 * x0;
      len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
      if (!len) {
        y0 = 0;
        y1 = 0;
        y2 = 0;
      } else {
        len = 1 / len;
        y0 *= len;
        y1 *= len;
        y2 *= len;
      }
      out[0] = x0;
      out[1] = y0;
      out[2] = z0;
      out[3] = 0;
      out[4] = x1;
      out[5] = y1;
      out[6] = z1;
      out[7] = 0;
      out[8] = x2;
      out[9] = y2;
      out[10] = z2;
      out[11] = 0;
      out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
      out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
      out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
      out[15] = 1;
      return out;
    };
    mat4.str = function(a) {
      return 'mat4(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ', ' + a[4] + ', ' + a[5] + ', ' + a[6] + ', ' + a[7] + ', ' + a[8] + ', ' + a[9] + ', ' + a[10] + ', ' + a[11] + ', ' + a[12] + ', ' + a[13] + ', ' + a[14] + ', ' + a[15] + ')';
    };
    mat4.frob = function(a) {
      return (Math.sqrt(Math.pow(a[0], 2) + Math.pow(a[1], 2) + Math.pow(a[2], 2) + Math.pow(a[3], 2) + Math.pow(a[4], 2) + Math.pow(a[5], 2) + Math.pow(a[6], 2) + Math.pow(a[7], 2) + Math.pow(a[8], 2) + Math.pow(a[9], 2) + Math.pow(a[10], 2) + Math.pow(a[11], 2) + Math.pow(a[12], 2) + Math.pow(a[13], 2) + Math.pow(a[14], 2) + Math.pow(a[15], 2)));
    };
    if (typeof(exports) !== 'undefined') {
      exports.mat4 = mat4;
    }
    ;
    var quat = {};
    quat.create = function() {
      var out = new GLMAT_ARRAY_TYPE(4);
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    };
    quat.rotationTo = (function() {
      var tmpvec3 = vec3.create();
      var xUnitVec3 = vec3.fromValues(1, 0, 0);
      var yUnitVec3 = vec3.fromValues(0, 1, 0);
      return function(out, a, b) {
        var dot = vec3.dot(a, b);
        if (dot < -0.999999) {
          vec3.cross(tmpvec3, xUnitVec3, a);
          if (vec3.length(tmpvec3) < 0.000001)
            vec3.cross(tmpvec3, yUnitVec3, a);
          vec3.normalize(tmpvec3, tmpvec3);
          quat.setAxisAngle(out, tmpvec3, Math.PI);
          return out;
        } else if (dot > 0.999999) {
          out[0] = 0;
          out[1] = 0;
          out[2] = 0;
          out[3] = 1;
          return out;
        } else {
          vec3.cross(tmpvec3, a, b);
          out[0] = tmpvec3[0];
          out[1] = tmpvec3[1];
          out[2] = tmpvec3[2];
          out[3] = 1 + dot;
          return quat.normalize(out, out);
        }
      };
    })();
    quat.setAxes = (function() {
      var matr = mat3.create();
      return function(out, view, right, up) {
        matr[0] = right[0];
        matr[3] = right[1];
        matr[6] = right[2];
        matr[1] = up[0];
        matr[4] = up[1];
        matr[7] = up[2];
        matr[2] = -view[0];
        matr[5] = -view[1];
        matr[8] = -view[2];
        return quat.normalize(out, quat.fromMat3(out, matr));
      };
    })();
    quat.clone = vec4.clone;
    quat.fromValues = vec4.fromValues;
    quat.copy = vec4.copy;
    quat.set = vec4.set;
    quat.identity = function(out) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    };
    quat.setAxisAngle = function(out, axis, rad) {
      rad = rad * 0.5;
      var s = Math.sin(rad);
      out[0] = s * axis[0];
      out[1] = s * axis[1];
      out[2] = s * axis[2];
      out[3] = Math.cos(rad);
      return out;
    };
    quat.add = vec4.add;
    quat.multiply = function(out, a, b) {
      var ax = a[0],
          ay = a[1],
          az = a[2],
          aw = a[3],
          bx = b[0],
          by = b[1],
          bz = b[2],
          bw = b[3];
      out[0] = ax * bw + aw * bx + ay * bz - az * by;
      out[1] = ay * bw + aw * by + az * bx - ax * bz;
      out[2] = az * bw + aw * bz + ax * by - ay * bx;
      out[3] = aw * bw - ax * bx - ay * by - az * bz;
      return out;
    };
    quat.mul = quat.multiply;
    quat.scale = vec4.scale;
    quat.rotateX = function(out, a, rad) {
      rad *= 0.5;
      var ax = a[0],
          ay = a[1],
          az = a[2],
          aw = a[3],
          bx = Math.sin(rad),
          bw = Math.cos(rad);
      out[0] = ax * bw + aw * bx;
      out[1] = ay * bw + az * bx;
      out[2] = az * bw - ay * bx;
      out[3] = aw * bw - ax * bx;
      return out;
    };
    quat.rotateY = function(out, a, rad) {
      rad *= 0.5;
      var ax = a[0],
          ay = a[1],
          az = a[2],
          aw = a[3],
          by = Math.sin(rad),
          bw = Math.cos(rad);
      out[0] = ax * bw - az * by;
      out[1] = ay * bw + aw * by;
      out[2] = az * bw + ax * by;
      out[3] = aw * bw - ay * by;
      return out;
    };
    quat.rotateZ = function(out, a, rad) {
      rad *= 0.5;
      var ax = a[0],
          ay = a[1],
          az = a[2],
          aw = a[3],
          bz = Math.sin(rad),
          bw = Math.cos(rad);
      out[0] = ax * bw + ay * bz;
      out[1] = ay * bw - ax * bz;
      out[2] = az * bw + aw * bz;
      out[3] = aw * bw - az * bz;
      return out;
    };
    quat.calculateW = function(out, a) {
      var x = a[0],
          y = a[1],
          z = a[2];
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = Math.sqrt(Math.abs(1.0 - x * x - y * y - z * z));
      return out;
    };
    quat.dot = vec4.dot;
    quat.lerp = vec4.lerp;
    quat.slerp = function(out, a, b, t) {
      var ax = a[0],
          ay = a[1],
          az = a[2],
          aw = a[3],
          bx = b[0],
          by = b[1],
          bz = b[2],
          bw = b[3];
      var omega,
          cosom,
          sinom,
          scale0,
          scale1;
      cosom = ax * bx + ay * by + az * bz + aw * bw;
      if (cosom < 0.0) {
        cosom = -cosom;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
      }
      if ((1.0 - cosom) > 0.000001) {
        omega = Math.acos(cosom);
        sinom = Math.sin(omega);
        scale0 = Math.sin((1.0 - t) * omega) / sinom;
        scale1 = Math.sin(t * omega) / sinom;
      } else {
        scale0 = 1.0 - t;
        scale1 = t;
      }
      out[0] = scale0 * ax + scale1 * bx;
      out[1] = scale0 * ay + scale1 * by;
      out[2] = scale0 * az + scale1 * bz;
      out[3] = scale0 * aw + scale1 * bw;
      return out;
    };
    quat.invert = function(out, a) {
      var a0 = a[0],
          a1 = a[1],
          a2 = a[2],
          a3 = a[3],
          dot = a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3,
          invDot = dot ? 1.0 / dot : 0;
      out[0] = -a0 * invDot;
      out[1] = -a1 * invDot;
      out[2] = -a2 * invDot;
      out[3] = a3 * invDot;
      return out;
    };
    quat.conjugate = function(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = a[3];
      return out;
    };
    quat.length = vec4.length;
    quat.len = quat.length;
    quat.squaredLength = vec4.squaredLength;
    quat.sqrLen = quat.squaredLength;
    quat.normalize = vec4.normalize;
    quat.fromMat3 = function(out, m) {
      var fTrace = m[0] + m[4] + m[8];
      var fRoot;
      if (fTrace > 0.0) {
        fRoot = Math.sqrt(fTrace + 1.0);
        out[3] = 0.5 * fRoot;
        fRoot = 0.5 / fRoot;
        out[0] = (m[5] - m[7]) * fRoot;
        out[1] = (m[6] - m[2]) * fRoot;
        out[2] = (m[1] - m[3]) * fRoot;
      } else {
        var i = 0;
        if (m[4] > m[0])
          i = 1;
        if (m[8] > m[i * 3 + i])
          i = 2;
        var j = (i + 1) % 3;
        var k = (i + 2) % 3;
        fRoot = Math.sqrt(m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k] + 1.0);
        out[i] = 0.5 * fRoot;
        fRoot = 0.5 / fRoot;
        out[3] = (m[j * 3 + k] - m[k * 3 + j]) * fRoot;
        out[j] = (m[j * 3 + i] + m[i * 3 + j]) * fRoot;
        out[k] = (m[k * 3 + i] + m[i * 3 + k]) * fRoot;
      }
      return out;
    };
    quat.str = function(a) {
      return 'quat(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ')';
    };
    if (typeof(exports) !== 'undefined') {
      exports.quat = quat;
    }
    ;
  })(shim.exports);
})(this);
})();
System.register("npm:core-js@0.9.10/library/modules/es6.object.statics-accept-primitives", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.def"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      $def = require("npm:core-js@0.9.10/library/modules/$.def"),
      isObject = $.isObject,
      toObject = $.toObject;
  $.each.call(('freeze,seal,preventExtensions,isFrozen,isSealed,isExtensible,' + 'getOwnPropertyDescriptor,getPrototypeOf,keys,getOwnPropertyNames').split(','), function(KEY, ID) {
    var fn = ($.core.Object || {})[KEY] || Object[KEY],
        forced = 0,
        method = {};
    method[KEY] = ID == 0 ? function freeze(it) {
      return isObject(it) ? fn(it) : it;
    } : ID == 1 ? function seal(it) {
      return isObject(it) ? fn(it) : it;
    } : ID == 2 ? function preventExtensions(it) {
      return isObject(it) ? fn(it) : it;
    } : ID == 3 ? function isFrozen(it) {
      return isObject(it) ? fn(it) : true;
    } : ID == 4 ? function isSealed(it) {
      return isObject(it) ? fn(it) : true;
    } : ID == 5 ? function isExtensible(it) {
      return isObject(it) ? fn(it) : false;
    } : ID == 6 ? function getOwnPropertyDescriptor(it, key) {
      return fn(toObject(it), key);
    } : ID == 7 ? function getPrototypeOf(it) {
      return fn(Object($.assertDefined(it)));
    } : ID == 8 ? function keys(it) {
      return fn(toObject(it));
    } : function getOwnPropertyNames(it) {
      return fn(toObject(it));
    };
    try {
      fn('z');
    } catch (e) {
      forced = 1;
    }
    $def($def.S + $def.F * forced, 'Object', method);
  });
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/object/define-property", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$");
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.collection-strong", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.ctx", "npm:core-js@0.9.10/library/modules/$.uid", "npm:core-js@0.9.10/library/modules/$.assert", "npm:core-js@0.9.10/library/modules/$.for-of", "npm:core-js@0.9.10/library/modules/$.iter", "npm:core-js@0.9.10/library/modules/$.mix", "npm:core-js@0.9.10/library/modules/$.iter-define"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      ctx = require("npm:core-js@0.9.10/library/modules/$.ctx"),
      safe = require("npm:core-js@0.9.10/library/modules/$.uid").safe,
      assert = require("npm:core-js@0.9.10/library/modules/$.assert"),
      forOf = require("npm:core-js@0.9.10/library/modules/$.for-of"),
      step = require("npm:core-js@0.9.10/library/modules/$.iter").step,
      has = $.has,
      set = $.set,
      isObject = $.isObject,
      hide = $.hide,
      isFrozen = Object.isFrozen || $.core.Object.isFrozen,
      ID = safe('id'),
      O1 = safe('O1'),
      LAST = safe('last'),
      FIRST = safe('first'),
      ITER = safe('iter'),
      SIZE = $.DESC ? safe('size') : 'size',
      id = 0;
  function fastKey(it, create) {
    if (!isObject(it))
      return (typeof it == 'string' ? 'S' : 'P') + it;
    if (isFrozen(it))
      return 'F';
    if (!has(it, ID)) {
      if (!create)
        return 'E';
      hide(it, ID, ++id);
    }
    return 'O' + it[ID];
  }
  function getEntry(that, key) {
    var index = fastKey(key),
        entry;
    if (index != 'F')
      return that[O1][index];
    for (entry = that[FIRST]; entry; entry = entry.n) {
      if (entry.k == key)
        return entry;
    }
  }
  module.exports = {
    getConstructor: function(NAME, IS_MAP, ADDER) {
      function C() {
        var that = assert.inst(this, C, NAME),
            iterable = arguments[0];
        set(that, O1, $.create(null));
        set(that, SIZE, 0);
        set(that, LAST, undefined);
        set(that, FIRST, undefined);
        if (iterable != undefined)
          forOf(iterable, IS_MAP, that[ADDER], that);
      }
      require("npm:core-js@0.9.10/library/modules/$.mix")(C.prototype, {
        clear: function clear() {
          for (var that = this,
              data = that[O1],
              entry = that[FIRST]; entry; entry = entry.n) {
            entry.r = true;
            if (entry.p)
              entry.p = entry.p.n = undefined;
            delete data[entry.i];
          }
          that[FIRST] = that[LAST] = undefined;
          that[SIZE] = 0;
        },
        'delete': function(key) {
          var that = this,
              entry = getEntry(that, key);
          if (entry) {
            var next = entry.n,
                prev = entry.p;
            delete that[O1][entry.i];
            entry.r = true;
            if (prev)
              prev.n = next;
            if (next)
              next.p = prev;
            if (that[FIRST] == entry)
              that[FIRST] = next;
            if (that[LAST] == entry)
              that[LAST] = prev;
            that[SIZE]--;
          }
          return !!entry;
        },
        forEach: function forEach(callbackfn) {
          var f = ctx(callbackfn, arguments[1], 3),
              entry;
          while (entry = entry ? entry.n : this[FIRST]) {
            f(entry.v, entry.k, this);
            while (entry && entry.r)
              entry = entry.p;
          }
        },
        has: function has(key) {
          return !!getEntry(this, key);
        }
      });
      if ($.DESC)
        $.setDesc(C.prototype, 'size', {get: function() {
            return assert.def(this[SIZE]);
          }});
      return C;
    },
    def: function(that, key, value) {
      var entry = getEntry(that, key),
          prev,
          index;
      if (entry) {
        entry.v = value;
      } else {
        that[LAST] = entry = {
          i: index = fastKey(key, true),
          k: key,
          v: value,
          p: prev = that[LAST],
          n: undefined,
          r: false
        };
        if (!that[FIRST])
          that[FIRST] = entry;
        if (prev)
          prev.n = entry;
        that[SIZE]++;
        if (index != 'F')
          that[O1][index] = entry;
      }
      return that;
    },
    getEntry: getEntry,
    setIter: function(C, NAME, IS_MAP) {
      require("npm:core-js@0.9.10/library/modules/$.iter-define")(C, NAME, function(iterated, kind) {
        set(this, ITER, {
          o: iterated,
          k: kind
        });
      }, function() {
        var iter = this[ITER],
            kind = iter.k,
            entry = iter.l;
        while (entry && entry.r)
          entry = entry.p;
        if (!iter.o || !(iter.l = entry = entry ? entry.n : iter.o[FIRST])) {
          iter.o = undefined;
          return step(1);
        }
        if (kind == 'keys')
          return step(0, entry.k);
        if (kind == 'values')
          return step(0, entry.v);
        return step(0, [entry.k, entry.v]);
      }, IS_MAP ? 'entries' : 'values', !IS_MAP, true);
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.collection-to-json", ["npm:core-js@0.9.10/library/modules/$.def", "npm:core-js@0.9.10/library/modules/$.for-of"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $def = require("npm:core-js@0.9.10/library/modules/$.def"),
      forOf = require("npm:core-js@0.9.10/library/modules/$.for-of");
  module.exports = function(NAME) {
    $def($def.P, NAME, {toJSON: function toJSON() {
        var arr = [];
        forOf(this, false, arr.push, arr);
        return arr;
      }});
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.set", ["npm:core-js@0.9.10/library/modules/$.collection-strong", "npm:core-js@0.9.10/library/modules/$.collection"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var strong = require("npm:core-js@0.9.10/library/modules/$.collection-strong");
  require("npm:core-js@0.9.10/library/modules/$.collection")('Set', {add: function add(value) {
      return strong.def(this, value = value === 0 ? 0 : value, value);
    }}, strong);
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es7.set.to-json", ["npm:core-js@0.9.10/library/modules/$.collection-to-json"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/$.collection-to-json")('Set');
  global.define = __define;
  return module.exports;
});

System.register("github:mrdoob/stats.js@master/src/Stats", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var Stats = function() {
    var startTime = Date.now(),
        prevTime = startTime;
    var ms = 0,
        msMin = Infinity,
        msMax = 0;
    var fps = 0,
        fpsMin = Infinity,
        fpsMax = 0;
    var frames = 0,
        mode = 0;
    var container = document.createElement('div');
    container.id = 'stats';
    container.addEventListener('mousedown', function(event) {
      event.preventDefault();
      setMode(++mode % 2);
    }, false);
    container.style.cssText = 'width:80px;opacity:0.9;cursor:pointer';
    var fpsDiv = document.createElement('div');
    fpsDiv.id = 'fps';
    fpsDiv.style.cssText = 'padding:0 0 3px 3px;text-align:left;background-color:#002';
    container.appendChild(fpsDiv);
    var fpsText = document.createElement('div');
    fpsText.id = 'fpsText';
    fpsText.style.cssText = 'color:#0ff;font-family:Helvetica,Arial,sans-serif;font-size:9px;font-weight:bold;line-height:15px';
    fpsText.innerHTML = 'FPS';
    fpsDiv.appendChild(fpsText);
    var fpsGraph = document.createElement('div');
    fpsGraph.id = 'fpsGraph';
    fpsGraph.style.cssText = 'position:relative;width:74px;height:30px;background-color:#0ff';
    fpsDiv.appendChild(fpsGraph);
    while (fpsGraph.children.length < 74) {
      var bar = document.createElement('span');
      bar.style.cssText = 'width:1px;height:30px;float:left;background-color:#113';
      fpsGraph.appendChild(bar);
    }
    var msDiv = document.createElement('div');
    msDiv.id = 'ms';
    msDiv.style.cssText = 'padding:0 0 3px 3px;text-align:left;background-color:#020;display:none';
    container.appendChild(msDiv);
    var msText = document.createElement('div');
    msText.id = 'msText';
    msText.style.cssText = 'color:#0f0;font-family:Helvetica,Arial,sans-serif;font-size:9px;font-weight:bold;line-height:15px';
    msText.innerHTML = 'MS';
    msDiv.appendChild(msText);
    var msGraph = document.createElement('div');
    msGraph.id = 'msGraph';
    msGraph.style.cssText = 'position:relative;width:74px;height:30px;background-color:#0f0';
    msDiv.appendChild(msGraph);
    while (msGraph.children.length < 74) {
      var bar = document.createElement('span');
      bar.style.cssText = 'width:1px;height:30px;float:left;background-color:#131';
      msGraph.appendChild(bar);
    }
    var setMode = function(value) {
      mode = value;
      switch (mode) {
        case 0:
          fpsDiv.style.display = 'block';
          msDiv.style.display = 'none';
          break;
        case 1:
          fpsDiv.style.display = 'none';
          msDiv.style.display = 'block';
          break;
      }
    };
    var updateGraph = function(dom, value) {
      var child = dom.appendChild(dom.firstChild);
      child.style.height = value + 'px';
    };
    return {
      REVISION: 12,
      domElement: container,
      setMode: setMode,
      begin: function() {
        startTime = Date.now();
      },
      end: function() {
        var time = Date.now();
        ms = time - startTime;
        msMin = Math.min(msMin, ms);
        msMax = Math.max(msMax, ms);
        msText.textContent = ms + ' MS (' + msMin + '-' + msMax + ')';
        updateGraph(msGraph, Math.min(30, 30 - (ms / 200) * 30));
        frames++;
        if (time > prevTime + 1000) {
          fps = Math.round((frames * 1000) / (time - prevTime));
          fpsMin = Math.min(fpsMin, fps);
          fpsMax = Math.max(fpsMax, fps);
          fpsText.textContent = fps + ' FPS (' + fpsMin + '-' + fpsMax + ')';
          updateGraph(fpsGraph, Math.min(30, 30 - (fps / 100) * 30));
          prevTime = time;
          frames = 0;
        }
        return time;
      },
      update: function() {
        startTime = this.end();
      }
    };
  };
  if (typeof module === 'object') {
    module.exports = Stats;
  }
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/symbol/iterator", ["npm:core-js@0.9.10/library/modules/es6.string.iterator", "npm:core-js@0.9.10/library/modules/web.dom.iterable", "npm:core-js@0.9.10/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.string.iterator");
  require("npm:core-js@0.9.10/library/modules/web.dom.iterable");
  module.exports = require("npm:core-js@0.9.10/library/modules/$.wks")('iterator');
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.keyof", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$");
  module.exports = function(object, el) {
    var O = $.toObject(object),
        keys = $.getKeys(O),
        length = keys.length,
        index = 0,
        key;
    while (length > index)
      if (O[key = keys[index++]] === el)
        return key;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.enum-keys", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$");
  module.exports = function(it) {
    var keys = $.getKeys(it),
        getDesc = $.getDesc,
        getSymbols = $.getSymbols;
    if (getSymbols)
      $.each.call(getSymbols(it), function(key) {
        if (getDesc(it, key).enumerable)
          keys.push(key);
      });
    return keys;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.array.from", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.ctx", "npm:core-js@0.9.10/library/modules/$.def", "npm:core-js@0.9.10/library/modules/$.iter", "npm:core-js@0.9.10/library/modules/$.iter-call", "npm:core-js@0.9.10/library/modules/$.iter-detect"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      ctx = require("npm:core-js@0.9.10/library/modules/$.ctx"),
      $def = require("npm:core-js@0.9.10/library/modules/$.def"),
      $iter = require("npm:core-js@0.9.10/library/modules/$.iter"),
      call = require("npm:core-js@0.9.10/library/modules/$.iter-call");
  $def($def.S + $def.F * !require("npm:core-js@0.9.10/library/modules/$.iter-detect")(function(iter) {
    Array.from(iter);
  }), 'Array', {from: function from(arrayLike) {
      var O = Object($.assertDefined(arrayLike)),
          mapfn = arguments[1],
          mapping = mapfn !== undefined,
          f = mapping ? ctx(mapfn, arguments[2], 2) : undefined,
          index = 0,
          length,
          result,
          step,
          iterator;
      if ($iter.is(O)) {
        iterator = $iter.get(O);
        result = new (typeof this == 'function' ? this : Array);
        for (; !(step = iterator.next()).done; index++) {
          result[index] = mapping ? call(iterator, f, [step.value, index], true) : step.value;
        }
      } else {
        result = new (typeof this == 'function' ? this : Array)(length = $.toLength(O.length));
        for (; length > index; index++) {
          result[index] = mapping ? f(O[index], index) : O[index];
        }
      }
      result.length = index;
      return result;
    }});
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/normalize-options", ["github:jspm/nodelibs-process@0.1.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var forEach = Array.prototype.forEach,
        create = Object.create;
    var process = function(src, obj) {
      var key;
      for (key in src)
        obj[key] = src[key];
    };
    module.exports = function(options) {
      var result = create(null);
      forEach.call(arguments, function(options) {
        if (options == null)
          return ;
        process(Object(options), result);
      });
      return result;
    };
  })(require("github:jspm/nodelibs-process@0.1.1"));
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/math/sign/is-implemented", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function() {
    var sign = Math.sign;
    if (typeof sign !== 'function')
      return false;
    return ((sign(10) === 1) && (sign(-20) === -1));
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/math/sign/shim", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function(value) {
    value = Number(value);
    if (isNaN(value) || (value === 0))
      return value;
    return (value > 0) ? 1 : -1;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/valid-callable", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function(fn) {
    if (typeof fn !== 'function')
      throw new TypeError(fn + " is not a function");
    return fn;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/is-callable", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function(obj) {
    return typeof obj === 'function';
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/valid-value", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function(value) {
    if (value == null)
      throw new TypeError("Cannot use null or undefined");
    return value;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/lib/registered-extensions", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  'use strict';
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/assign/is-implemented", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function() {
    var assign = Object.assign,
        obj;
    if (typeof assign !== 'function')
      return false;
    obj = {foo: 'raz'};
    assign(obj, {bar: 'dwa'}, {trzy: 'trzy'});
    return (obj.foo + obj.bar + obj.trzy) === 'razdwatrzy';
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/keys/is-implemented", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function() {
    try {
      Object.keys('primitive');
      return true;
    } catch (e) {
      return false;
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/keys/shim", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var keys = Object.keys;
  module.exports = function(object) {
    return keys(object == null ? object : Object(object));
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/mixin", ["npm:es5-ext@0.10.7/object/valid-value"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var value = require("npm:es5-ext@0.10.7/object/valid-value"),
      defineProperty = Object.defineProperty,
      getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor,
      getOwnPropertyNames = Object.getOwnPropertyNames;
  module.exports = function(target, source) {
    var error;
    target = Object(value(target));
    getOwnPropertyNames(Object(value(source))).forEach(function(name) {
      try {
        defineProperty(target, name, getOwnPropertyDescriptor(source, name));
      } catch (e) {
        error = e;
      }
    });
    if (error !== undefined)
      throw error;
    return target;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/assign", ["npm:es5-ext@0.10.7/object/assign/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:es5-ext@0.10.7/object/assign/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/string/#/contains/is-implemented", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var str = 'razdwatrzy';
  module.exports = function() {
    if (typeof str.contains !== 'function')
      return false;
    return ((str.contains('dwa') === true) && (str.contains('foo') === false));
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/string/#/contains/shim", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var indexOf = String.prototype.indexOf;
  module.exports = function(searchString) {
    return indexOf.call(this, searchString, arguments[1]) > -1;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:event-emitter@0.3.3/index", ["npm:d@0.1.1", "npm:es5-ext@0.10.7/object/valid-callable"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var d = require("npm:d@0.1.1"),
      callable = require("npm:es5-ext@0.10.7/object/valid-callable"),
      apply = Function.prototype.apply,
      call = Function.prototype.call,
      create = Object.create,
      defineProperty = Object.defineProperty,
      defineProperties = Object.defineProperties,
      hasOwnProperty = Object.prototype.hasOwnProperty,
      descriptor = {
        configurable: true,
        enumerable: false,
        writable: true
      },
      on,
      once,
      off,
      emit,
      methods,
      descriptors,
      base;
  on = function(type, listener) {
    var data;
    callable(listener);
    if (!hasOwnProperty.call(this, '__ee__')) {
      data = descriptor.value = create(null);
      defineProperty(this, '__ee__', descriptor);
      descriptor.value = null;
    } else {
      data = this.__ee__;
    }
    if (!data[type])
      data[type] = listener;
    else if (typeof data[type] === 'object')
      data[type].push(listener);
    else
      data[type] = [data[type], listener];
    return this;
  };
  once = function(type, listener) {
    var once,
        self;
    callable(listener);
    self = this;
    on.call(this, type, once = function() {
      off.call(self, type, once);
      apply.call(listener, this, arguments);
    });
    once.__eeOnceListener__ = listener;
    return this;
  };
  off = function(type, listener) {
    var data,
        listeners,
        candidate,
        i;
    callable(listener);
    if (!hasOwnProperty.call(this, '__ee__'))
      return this;
    data = this.__ee__;
    if (!data[type])
      return this;
    listeners = data[type];
    if (typeof listeners === 'object') {
      for (i = 0; (candidate = listeners[i]); ++i) {
        if ((candidate === listener) || (candidate.__eeOnceListener__ === listener)) {
          if (listeners.length === 2)
            data[type] = listeners[i ? 0 : 1];
          else
            listeners.splice(i, 1);
        }
      }
    } else {
      if ((listeners === listener) || (listeners.__eeOnceListener__ === listener)) {
        delete data[type];
      }
    }
    return this;
  };
  emit = function(type) {
    var i,
        l,
        listener,
        listeners,
        args;
    if (!hasOwnProperty.call(this, '__ee__'))
      return ;
    listeners = this.__ee__[type];
    if (!listeners)
      return ;
    if (typeof listeners === 'object') {
      l = arguments.length;
      args = new Array(l - 1);
      for (i = 1; i < l; ++i)
        args[i - 1] = arguments[i];
      listeners = listeners.slice();
      for (i = 0; (listener = listeners[i]); ++i) {
        apply.call(listener, this, args);
      }
    } else {
      switch (arguments.length) {
        case 1:
          call.call(listeners, this);
          break;
        case 2:
          call.call(listeners, this, arguments[1]);
          break;
        case 3:
          call.call(listeners, this, arguments[1], arguments[2]);
          break;
        default:
          l = arguments.length;
          args = new Array(l - 1);
          for (i = 1; i < l; ++i) {
            args[i - 1] = arguments[i];
          }
          apply.call(listeners, this, args);
      }
    }
  };
  methods = {
    on: on,
    once: once,
    off: off,
    emit: emit
  };
  descriptors = {
    on: d(on),
    once: d(once),
    off: d(off),
    emit: d(emit)
  };
  base = defineProperties({}, descriptors);
  module.exports = exports = function(o) {
    return (o == null) ? create(base) : defineProperties(Object(o), descriptors);
  };
  exports.methods = methods;
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/array/from/is-implemented", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function() {
    var from = Array.from,
        arr,
        result;
    if (typeof from !== 'function')
      return false;
    arr = ['raz', 'dwa'];
    result = from(arr);
    return Boolean(result && (result !== arr) && (result[1] === 'dwa'));
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es6-symbol@2.0.1/is-implemented", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function() {
    var symbol;
    if (typeof Symbol !== 'function')
      return false;
    symbol = Symbol('test symbol');
    try {
      String(symbol);
    } catch (e) {
      return false;
    }
    if (typeof Symbol.iterator === 'symbol')
      return true;
    if (typeof Symbol.isConcatSpreadable !== 'object')
      return false;
    if (typeof Symbol.iterator !== 'object')
      return false;
    if (typeof Symbol.toPrimitive !== 'object')
      return false;
    if (typeof Symbol.toStringTag !== 'object')
      return false;
    if (typeof Symbol.unscopables !== 'object')
      return false;
    return true;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es6-symbol@2.0.1/is-symbol", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function(x) {
    return (x && ((typeof x === 'symbol') || (x['@@toStringTag'] === 'Symbol'))) || false;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/function/is-arguments", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toString = Object.prototype.toString,
      id = toString.call((function() {
        return arguments;
      }()));
  module.exports = function(x) {
    return (toString.call(x) === id);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/function/noop", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function() {};
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/string/is-string", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toString = Object.prototype.toString,
      id = toString.call('');
  module.exports = function(x) {
    return (typeof x === 'string') || (x && (typeof x === 'object') && ((x instanceof String) || (toString.call(x) === id))) || false;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/lib/resolve-normalize", ["npm:es5-ext@0.10.7/object/valid-callable"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var callable = require("npm:es5-ext@0.10.7/object/valid-callable");
  module.exports = function(userNormalizer) {
    var normalizer;
    if (typeof userNormalizer === 'function')
      return {
        set: userNormalizer,
        get: userNormalizer
      };
    normalizer = {get: callable(userNormalizer.get)};
    if (userNormalizer.set !== undefined) {
      normalizer.set = callable(userNormalizer.set);
      normalizer.delete = callable(userNormalizer.delete);
      normalizer.clear = callable(userNormalizer.clear);
      return normalizer;
    }
    normalizer.set = normalizer.get;
    return normalizer;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/normalizers/primitive", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function(args) {
    var id,
        i,
        length = args.length;
    if (!length)
      return '\u0002';
    id = String(args[i = 0]);
    while (--length)
      id += '\u0001' + args[++i];
    return id;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/normalizers/get-primitive-fixed", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = function(length) {
    if (!length) {
      return function() {
        return '';
      };
    }
    return function(args) {
      var id = String(args[0]),
          i = 0,
          l = length;
      while (--l) {
        id += '\u0001' + args[++i];
      }
      return id;
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/array/#/e-index-of", ["npm:es5-ext@0.10.7/number/to-pos-integer", "npm:es5-ext@0.10.7/object/valid-value"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toPosInt = require("npm:es5-ext@0.10.7/number/to-pos-integer"),
      value = require("npm:es5-ext@0.10.7/object/valid-value"),
      indexOf = Array.prototype.indexOf,
      hasOwnProperty = Object.prototype.hasOwnProperty,
      abs = Math.abs,
      floor = Math.floor;
  module.exports = function(searchElement) {
    var i,
        l,
        fromIndex,
        val;
    if (searchElement === searchElement) {
      return indexOf.apply(this, arguments);
    }
    l = toPosInt(value(this).length);
    fromIndex = arguments[1];
    if (isNaN(fromIndex))
      fromIndex = 0;
    else if (fromIndex >= 0)
      fromIndex = floor(fromIndex);
    else
      fromIndex = toPosInt(this.length) - floor(abs(fromIndex));
    for (i = fromIndex; i < l; ++i) {
      if (hasOwnProperty.call(this, i)) {
        val = this[i];
        if (val !== val)
          return i;
      }
    }
    return -1;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/normalizers/get-1", ["npm:es5-ext@0.10.7/array/#/e-index-of"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var indexOf = require("npm:es5-ext@0.10.7/array/#/e-index-of");
  module.exports = function() {
    var lastId = 0,
        argsMap = [],
        cache = [];
    return {
      get: function(args) {
        var index = indexOf.call(argsMap, args[0]);
        return (index === -1) ? null : cache[index];
      },
      set: function(args) {
        argsMap.push(args[0]);
        cache.push(++lastId);
        return lastId;
      },
      delete: function(id) {
        var index = indexOf.call(cache, id);
        if (index !== -1) {
          argsMap.splice(index, 1);
          cache.splice(index, 1);
        }
      },
      clear: function() {
        argsMap = [];
        cache = [];
      }
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/normalizers/get-fixed", ["npm:es5-ext@0.10.7/array/#/e-index-of"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var indexOf = require("npm:es5-ext@0.10.7/array/#/e-index-of"),
      create = Object.create;
  module.exports = function(length) {
    var lastId = 0,
        map = [[], []],
        cache = create(null);
    return {
      get: function(args) {
        var index = 0,
            set = map,
            i;
        while (index < (length - 1)) {
          i = indexOf.call(set[0], args[index]);
          if (i === -1)
            return null;
          set = set[1][i];
          ++index;
        }
        i = indexOf.call(set[0], args[index]);
        if (i === -1)
          return null;
        return set[1][i] || null;
      },
      set: function(args) {
        var index = 0,
            set = map,
            i;
        while (index < (length - 1)) {
          i = indexOf.call(set[0], args[index]);
          if (i === -1) {
            i = set[0].push(args[index]) - 1;
            set[1].push([[], []]);
          }
          set = set[1][i];
          ++index;
        }
        i = indexOf.call(set[0], args[index]);
        if (i === -1) {
          i = set[0].push(args[index]) - 1;
        }
        set[1][i] = ++lastId;
        cache[lastId] = args;
        return lastId;
      },
      delete: function(id) {
        var index = 0,
            set = map,
            i,
            path = [],
            args = cache[id];
        while (index < (length - 1)) {
          i = indexOf.call(set[0], args[index]);
          if (i === -1) {
            return ;
          }
          path.push(set, i);
          set = set[1][i];
          ++index;
        }
        i = indexOf.call(set[0], args[index]);
        if (i === -1) {
          return ;
        }
        id = set[1][i];
        set[0].splice(i, 1);
        set[1].splice(i, 1);
        while (!set[0].length && path.length) {
          i = path.pop();
          set = path.pop();
          set[0].splice(i, 1);
          set[1].splice(i, 1);
        }
        delete cache[id];
      },
      clear: function() {
        map = [[], []];
        cache = create(null);
      }
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/array/from", ["npm:es5-ext@0.10.7/array/from/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:es5-ext@0.10.7/array/from/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:next-tick@0.2.2/index", ["github:jspm/nodelibs-process@0.1.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var callable,
        byObserver;
    callable = function(fn) {
      if (typeof fn !== 'function')
        throw new TypeError(fn + " is not a function");
      return fn;
    };
    byObserver = function(Observer) {
      var node = document.createTextNode(''),
          queue,
          i = 0;
      new Observer(function() {
        var data;
        if (!queue)
          return ;
        data = queue;
        queue = null;
        if (typeof data === 'function') {
          data();
          return ;
        }
        data.forEach(function(fn) {
          fn();
        });
      }).observe(node, {characterData: true});
      return function(fn) {
        callable(fn);
        if (queue) {
          if (typeof queue === 'function')
            queue = [queue, fn];
          else
            queue.push(fn);
          return ;
        }
        queue = fn;
        node.data = (i = ++i % 2);
      };
    };
    module.exports = (function() {
      if ((typeof process !== 'undefined') && process && (typeof process.nextTick === 'function')) {
        return process.nextTick;
      }
      if ((typeof document === 'object') && document) {
        if (typeof MutationObserver === 'function') {
          return byObserver(MutationObserver);
        }
        if (typeof WebKitMutationObserver === 'function') {
          return byObserver(WebKitMutationObserver);
        }
      }
      if (typeof setImmediate === 'function') {
        return function(cb) {
          setImmediate(callable(cb));
        };
      }
      if (typeof setTimeout === 'function') {
        return function(cb) {
          setTimeout(callable(cb), 0);
        };
      }
      return null;
    }());
  })(require("github:jspm/nodelibs-process@0.1.1"));
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/ext/dispose", ["npm:es5-ext@0.10.7/object/valid-callable", "npm:es5-ext@0.10.7/object/for-each", "npm:memoizee@0.3.8/lib/registered-extensions"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var callable = require("npm:es5-ext@0.10.7/object/valid-callable"),
      forEach = require("npm:es5-ext@0.10.7/object/for-each"),
      extensions = require("npm:memoizee@0.3.8/lib/registered-extensions"),
      slice = Array.prototype.slice,
      apply = Function.prototype.apply;
  extensions.dispose = function(dispose, conf, options) {
    var del;
    callable(dispose);
    if (options.async && extensions.async) {
      conf.on('deleteasync', del = function(id, result) {
        apply.call(dispose, null, slice.call(result.args, 1));
      });
      conf.on('clearasync', function(cache) {
        forEach(cache, function(result, id) {
          del(id, result);
        });
      });
      return ;
    }
    conf.on('delete', del = function(id, result) {
      dispose(result);
    });
    conf.on('clear', function(cache) {
      forEach(cache, function(result, id) {
        del(id, result);
      });
    });
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:timers-ext@0.1.0/max-timeout", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = 2147483647;
  global.define = __define;
  return module.exports;
});

System.register("npm:lru-queue@0.1.0/index", ["npm:es5-ext@0.10.7/number/to-pos-integer"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toPosInt = require("npm:es5-ext@0.10.7/number/to-pos-integer"),
      create = Object.create,
      hasOwnProperty = Object.prototype.hasOwnProperty;
  module.exports = function(limit) {
    var size = 0,
        base = 1,
        queue = create(null),
        map = create(null),
        index = 0,
        del;
    limit = toPosInt(limit);
    return {
      hit: function(id) {
        var oldIndex = map[id],
            nuIndex = ++index;
        queue[nuIndex] = id;
        map[id] = nuIndex;
        if (!oldIndex) {
          ++size;
          if (size <= limit)
            return ;
          id = queue[base];
          del(id);
          return id;
        }
        delete queue[oldIndex];
        if (base !== oldIndex)
          return ;
        while (!hasOwnProperty.call(queue, ++base))
          continue;
      },
      delete: del = function(id) {
        var oldIndex = map[id];
        if (!oldIndex)
          return ;
        delete queue[oldIndex];
        delete map[id];
        --size;
        if (base !== oldIndex)
          return ;
        if (!size) {
          index = 0;
          base = 1;
          return ;
        }
        while (!hasOwnProperty.call(queue, ++base))
          continue;
      },
      clear: function() {
        size = 0;
        base = 1;
        queue = create(null);
        map = create(null);
        index = 0;
      }
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/ext/ref-counter", ["npm:d@0.1.1", "npm:memoizee@0.3.8/lib/registered-extensions"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var d = require("npm:d@0.1.1"),
      extensions = require("npm:memoizee@0.3.8/lib/registered-extensions"),
      create = Object.create,
      defineProperties = Object.defineProperties;
  extensions.refCounter = function(ignore, conf, options) {
    var cache,
        postfix;
    cache = create(null);
    postfix = (options.async && extensions.async) ? 'async' : '';
    conf.on('set' + postfix, function(id, length) {
      cache[id] = length || 1;
    });
    conf.on('get' + postfix, function(id) {
      ++cache[id];
    });
    conf.on('delete' + postfix, function(id) {
      delete cache[id];
    });
    conf.on('clear' + postfix, function() {
      cache = {};
    });
    defineProperties(conf.memoized, {
      deleteRef: d(function() {
        var id = conf.get(arguments);
        if (id === null)
          return null;
        if (!cache[id])
          return null;
        if (!--cache[id]) {
          conf.delete(id);
          return true;
        }
        return false;
      }),
      getRefCount: d(function() {
        var id = conf.get(arguments);
        if (id === null)
          return 0;
        if (!cache[id])
          return 0;
        return cache[id];
      })
    });
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/helpers/bind", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  exports["default"] = Function.prototype.bind;
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

System.register("github:toji/gl-matrix@master/src/gl-matrix/vec3.js!github:systemjs/plugin-text@0.0.2", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = "/* Copyright (c) 2015, Brandon Jones, Colin MacKenzie IV.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE. */\n\n/**\n * @class 3 Dimensional Vector\n * @name vec3\n */\nvar vec3 = {};\n\n/**\n * Creates a new, empty vec3\n *\n * @returns {vec3} a new 3D vector\n */\nvec3.create = function() {\n    var out = new GLMAT_ARRAY_TYPE(3);\n    out[0] = 0;\n    out[1] = 0;\n    out[2] = 0;\n    return out;\n};\n\n/**\n * Creates a new vec3 initialized with values from an existing vector\n *\n * @param {vec3} a vector to clone\n * @returns {vec3} a new 3D vector\n */\nvec3.clone = function(a) {\n    var out = new GLMAT_ARRAY_TYPE(3);\n    out[0] = a[0];\n    out[1] = a[1];\n    out[2] = a[2];\n    return out;\n};\n\n/**\n * Creates a new vec3 initialized with the given values\n *\n * @param {Number} x X component\n * @param {Number} y Y component\n * @param {Number} z Z component\n * @returns {vec3} a new 3D vector\n */\nvec3.fromValues = function(x, y, z) {\n    var out = new GLMAT_ARRAY_TYPE(3);\n    out[0] = x;\n    out[1] = y;\n    out[2] = z;\n    return out;\n};\n\n/**\n * Copy the values from one vec3 to another\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the source vector\n * @returns {vec3} out\n */\nvec3.copy = function(out, a) {\n    out[0] = a[0];\n    out[1] = a[1];\n    out[2] = a[2];\n    return out;\n};\n\n/**\n * Set the components of a vec3 to the given values\n *\n * @param {vec3} out the receiving vector\n * @param {Number} x X component\n * @param {Number} y Y component\n * @param {Number} z Z component\n * @returns {vec3} out\n */\nvec3.set = function(out, x, y, z) {\n    out[0] = x;\n    out[1] = y;\n    out[2] = z;\n    return out;\n};\n\n/**\n * Adds two vec3's\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {vec3} out\n */\nvec3.add = function(out, a, b) {\n    out[0] = a[0] + b[0];\n    out[1] = a[1] + b[1];\n    out[2] = a[2] + b[2];\n    return out;\n};\n\n/**\n * Subtracts vector b from vector a\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {vec3} out\n */\nvec3.subtract = function(out, a, b) {\n    out[0] = a[0] - b[0];\n    out[1] = a[1] - b[1];\n    out[2] = a[2] - b[2];\n    return out;\n};\n\n/**\n * Alias for {@link vec3.subtract}\n * @function\n */\nvec3.sub = vec3.subtract;\n\n/**\n * Multiplies two vec3's\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {vec3} out\n */\nvec3.multiply = function(out, a, b) {\n    out[0] = a[0] * b[0];\n    out[1] = a[1] * b[1];\n    out[2] = a[2] * b[2];\n    return out;\n};\n\n/**\n * Alias for {@link vec3.multiply}\n * @function\n */\nvec3.mul = vec3.multiply;\n\n/**\n * Divides two vec3's\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {vec3} out\n */\nvec3.divide = function(out, a, b) {\n    out[0] = a[0] / b[0];\n    out[1] = a[1] / b[1];\n    out[2] = a[2] / b[2];\n    return out;\n};\n\n/**\n * Alias for {@link vec3.divide}\n * @function\n */\nvec3.div = vec3.divide;\n\n/**\n * Returns the minimum of two vec3's\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {vec3} out\n */\nvec3.min = function(out, a, b) {\n    out[0] = Math.min(a[0], b[0]);\n    out[1] = Math.min(a[1], b[1]);\n    out[2] = Math.min(a[2], b[2]);\n    return out;\n};\n\n/**\n * Returns the maximum of two vec3's\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {vec3} out\n */\nvec3.max = function(out, a, b) {\n    out[0] = Math.max(a[0], b[0]);\n    out[1] = Math.max(a[1], b[1]);\n    out[2] = Math.max(a[2], b[2]);\n    return out;\n};\n\n/**\n * Scales a vec3 by a scalar number\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the vector to scale\n * @param {Number} b amount to scale the vector by\n * @returns {vec3} out\n */\nvec3.scale = function(out, a, b) {\n    out[0] = a[0] * b;\n    out[1] = a[1] * b;\n    out[2] = a[2] * b;\n    return out;\n};\n\n/**\n * Adds two vec3's after scaling the second operand by a scalar value\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @param {Number} scale the amount to scale b by before adding\n * @returns {vec3} out\n */\nvec3.scaleAndAdd = function(out, a, b, scale) {\n    out[0] = a[0] + (b[0] * scale);\n    out[1] = a[1] + (b[1] * scale);\n    out[2] = a[2] + (b[2] * scale);\n    return out;\n};\n\n/**\n * Calculates the euclidian distance between two vec3's\n *\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {Number} distance between a and b\n */\nvec3.distance = function(a, b) {\n    var x = b[0] - a[0],\n        y = b[1] - a[1],\n        z = b[2] - a[2];\n    return Math.sqrt(x*x + y*y + z*z);\n};\n\n/**\n * Alias for {@link vec3.distance}\n * @function\n */\nvec3.dist = vec3.distance;\n\n/**\n * Calculates the squared euclidian distance between two vec3's\n *\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {Number} squared distance between a and b\n */\nvec3.squaredDistance = function(a, b) {\n    var x = b[0] - a[0],\n        y = b[1] - a[1],\n        z = b[2] - a[2];\n    return x*x + y*y + z*z;\n};\n\n/**\n * Alias for {@link vec3.squaredDistance}\n * @function\n */\nvec3.sqrDist = vec3.squaredDistance;\n\n/**\n * Calculates the length of a vec3\n *\n * @param {vec3} a vector to calculate length of\n * @returns {Number} length of a\n */\nvec3.length = function (a) {\n    var x = a[0],\n        y = a[1],\n        z = a[2];\n    return Math.sqrt(x*x + y*y + z*z);\n};\n\n/**\n * Alias for {@link vec3.length}\n * @function\n */\nvec3.len = vec3.length;\n\n/**\n * Calculates the squared length of a vec3\n *\n * @param {vec3} a vector to calculate squared length of\n * @returns {Number} squared length of a\n */\nvec3.squaredLength = function (a) {\n    var x = a[0],\n        y = a[1],\n        z = a[2];\n    return x*x + y*y + z*z;\n};\n\n/**\n * Alias for {@link vec3.squaredLength}\n * @function\n */\nvec3.sqrLen = vec3.squaredLength;\n\n/**\n * Negates the components of a vec3\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a vector to negate\n * @returns {vec3} out\n */\nvec3.negate = function(out, a) {\n    out[0] = -a[0];\n    out[1] = -a[1];\n    out[2] = -a[2];\n    return out;\n};\n\n/**\n * Returns the inverse of the components of a vec3\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a vector to invert\n * @returns {vec3} out\n */\nvec3.inverse = function(out, a) {\n  out[0] = 1.0 / a[0];\n  out[1] = 1.0 / a[1];\n  out[2] = 1.0 / a[2];\n  return out;\n};\n\n/**\n * Normalize a vec3\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a vector to normalize\n * @returns {vec3} out\n */\nvec3.normalize = function(out, a) {\n    var x = a[0],\n        y = a[1],\n        z = a[2];\n    var len = x*x + y*y + z*z;\n    if (len > 0) {\n        //TODO: evaluate use of glm_invsqrt here?\n        len = 1 / Math.sqrt(len);\n        out[0] = a[0] * len;\n        out[1] = a[1] * len;\n        out[2] = a[2] * len;\n    }\n    return out;\n};\n\n/**\n * Calculates the dot product of two vec3's\n *\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {Number} dot product of a and b\n */\nvec3.dot = function (a, b) {\n    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];\n};\n\n/**\n * Computes the cross product of two vec3's\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @returns {vec3} out\n */\nvec3.cross = function(out, a, b) {\n    var ax = a[0], ay = a[1], az = a[2],\n        bx = b[0], by = b[1], bz = b[2];\n\n    out[0] = ay * bz - az * by;\n    out[1] = az * bx - ax * bz;\n    out[2] = ax * by - ay * bx;\n    return out;\n};\n\n/**\n * Performs a linear interpolation between two vec3's\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @param {Number} t interpolation amount between the two inputs\n * @returns {vec3} out\n */\nvec3.lerp = function (out, a, b, t) {\n    var ax = a[0],\n        ay = a[1],\n        az = a[2];\n    out[0] = ax + t * (b[0] - ax);\n    out[1] = ay + t * (b[1] - ay);\n    out[2] = az + t * (b[2] - az);\n    return out;\n};\n\n/**\n * Performs a hermite interpolation with two control points\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @param {vec3} c the third operand\n * @param {vec3} d the fourth operand\n * @param {Number} t interpolation amount between the two inputs\n * @returns {vec3} out\n */\nvec3.hermite = function (out, a, b, c, d, t) {\n  var factorTimes2 = t * t,\n      factor1 = factorTimes2 * (2 * t - 3) + 1,\n      factor2 = factorTimes2 * (t - 2) + t,\n      factor3 = factorTimes2 * (t - 1),\n      factor4 = factorTimes2 * (3 - 2 * t);\n  \n  out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;\n  out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;\n  out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;\n  \n  return out;\n};\n\n/**\n * Performs a bezier interpolation with two control points\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the first operand\n * @param {vec3} b the second operand\n * @param {vec3} c the third operand\n * @param {vec3} d the fourth operand\n * @param {Number} t interpolation amount between the two inputs\n * @returns {vec3} out\n */\nvec3.bezier = function (out, a, b, c, d, t) {\n  var inverseFactor = 1 - t,\n      inverseFactorTimesTwo = inverseFactor * inverseFactor,\n      factorTimes2 = t * t,\n      factor1 = inverseFactorTimesTwo * inverseFactor,\n      factor2 = 3 * t * inverseFactorTimesTwo,\n      factor3 = 3 * factorTimes2 * inverseFactor,\n      factor4 = factorTimes2 * t;\n  \n  out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;\n  out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;\n  out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;\n  \n  return out;\n};\n\n/**\n * Generates a random vector with the given scale\n *\n * @param {vec3} out the receiving vector\n * @param {Number} [scale] Length of the resulting vector. If ommitted, a unit vector will be returned\n * @returns {vec3} out\n */\nvec3.random = function (out, scale) {\n    scale = scale || 1.0;\n\n    var r = GLMAT_RANDOM() * 2.0 * Math.PI;\n    var z = (GLMAT_RANDOM() * 2.0) - 1.0;\n    var zScale = Math.sqrt(1.0-z*z) * scale;\n\n    out[0] = Math.cos(r) * zScale;\n    out[1] = Math.sin(r) * zScale;\n    out[2] = z * scale;\n    return out;\n};\n\n/**\n * Transforms the vec3 with a mat4.\n * 4th vector component is implicitly '1'\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the vector to transform\n * @param {mat4} m matrix to transform with\n * @returns {vec3} out\n */\nvec3.transformMat4 = function(out, a, m) {\n    var x = a[0], y = a[1], z = a[2],\n        w = m[3] * x + m[7] * y + m[11] * z + m[15];\n    w = w || 1.0;\n    out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;\n    out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;\n    out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;\n    return out;\n};\n\n/**\n * Transforms the vec3 with a mat3.\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the vector to transform\n * @param {mat4} m the 3x3 matrix to transform with\n * @returns {vec3} out\n */\nvec3.transformMat3 = function(out, a, m) {\n    var x = a[0], y = a[1], z = a[2];\n    out[0] = x * m[0] + y * m[3] + z * m[6];\n    out[1] = x * m[1] + y * m[4] + z * m[7];\n    out[2] = x * m[2] + y * m[5] + z * m[8];\n    return out;\n};\n\n/**\n * Transforms the vec3 with a quat\n *\n * @param {vec3} out the receiving vector\n * @param {vec3} a the vector to transform\n * @param {quat} q quaternion to transform with\n * @returns {vec3} out\n */\nvec3.transformQuat = function(out, a, q) {\n    // benchmarks: http://jsperf.com/quaternion-transform-vec3-implementations\n\n    var x = a[0], y = a[1], z = a[2],\n        qx = q[0], qy = q[1], qz = q[2], qw = q[3],\n\n        // calculate quat * vec\n        ix = qw * x + qy * z - qz * y,\n        iy = qw * y + qz * x - qx * z,\n        iz = qw * z + qx * y - qy * x,\n        iw = -qx * x - qy * y - qz * z;\n\n    // calculate result * inverse quat\n    out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;\n    out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;\n    out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;\n    return out;\n};\n\n/**\n * Rotate a 3D vector around the x-axis\n * @param {vec3} out The receiving vec3\n * @param {vec3} a The vec3 point to rotate\n * @param {vec3} b The origin of the rotation\n * @param {Number} c The angle of rotation\n * @returns {vec3} out\n */\nvec3.rotateX = function(out, a, b, c){\n   var p = [], r=[];\n\t  //Translate point to the origin\n\t  p[0] = a[0] - b[0];\n\t  p[1] = a[1] - b[1];\n  \tp[2] = a[2] - b[2];\n\n\t  //perform rotation\n\t  r[0] = p[0];\n\t  r[1] = p[1]*Math.cos(c) - p[2]*Math.sin(c);\n\t  r[2] = p[1]*Math.sin(c) + p[2]*Math.cos(c);\n\n\t  //translate to correct position\n\t  out[0] = r[0] + b[0];\n\t  out[1] = r[1] + b[1];\n\t  out[2] = r[2] + b[2];\n\n  \treturn out;\n};\n\n/**\n * Rotate a 3D vector around the y-axis\n * @param {vec3} out The receiving vec3\n * @param {vec3} a The vec3 point to rotate\n * @param {vec3} b The origin of the rotation\n * @param {Number} c The angle of rotation\n * @returns {vec3} out\n */\nvec3.rotateY = function(out, a, b, c){\n  \tvar p = [], r=[];\n  \t//Translate point to the origin\n  \tp[0] = a[0] - b[0];\n  \tp[1] = a[1] - b[1];\n  \tp[2] = a[2] - b[2];\n  \n  \t//perform rotation\n  \tr[0] = p[2]*Math.sin(c) + p[0]*Math.cos(c);\n  \tr[1] = p[1];\n  \tr[2] = p[2]*Math.cos(c) - p[0]*Math.sin(c);\n  \n  \t//translate to correct position\n  \tout[0] = r[0] + b[0];\n  \tout[1] = r[1] + b[1];\n  \tout[2] = r[2] + b[2];\n  \n  \treturn out;\n};\n\n/**\n * Rotate a 3D vector around the z-axis\n * @param {vec3} out The receiving vec3\n * @param {vec3} a The vec3 point to rotate\n * @param {vec3} b The origin of the rotation\n * @param {Number} c The angle of rotation\n * @returns {vec3} out\n */\nvec3.rotateZ = function(out, a, b, c){\n  \tvar p = [], r=[];\n  \t//Translate point to the origin\n  \tp[0] = a[0] - b[0];\n  \tp[1] = a[1] - b[1];\n  \tp[2] = a[2] - b[2];\n  \n  \t//perform rotation\n  \tr[0] = p[0]*Math.cos(c) - p[1]*Math.sin(c);\n  \tr[1] = p[0]*Math.sin(c) + p[1]*Math.cos(c);\n  \tr[2] = p[2];\n  \n  \t//translate to correct position\n  \tout[0] = r[0] + b[0];\n  \tout[1] = r[1] + b[1];\n  \tout[2] = r[2] + b[2];\n  \n  \treturn out;\n};\n\n/**\n * Perform some operation over an array of vec3s.\n *\n * @param {Array} a the array of vectors to iterate over\n * @param {Number} stride Number of elements between the start of each vec3. If 0 assumes tightly packed\n * @param {Number} offset Number of elements to skip at the beginning of the array\n * @param {Number} count Number of vec3s to iterate over. If 0 iterates over entire array\n * @param {Function} fn Function to call for each vector in the array\n * @param {Object} [arg] additional argument to pass to fn\n * @returns {Array} a\n * @function\n */\nvec3.forEach = (function() {\n    var vec = vec3.create();\n\n    return function(a, stride, offset, count, fn, arg) {\n        var i, l;\n        if(!stride) {\n            stride = 3;\n        }\n\n        if(!offset) {\n            offset = 0;\n        }\n        \n        if(count) {\n            l = Math.min((count * stride) + offset, a.length);\n        } else {\n            l = a.length;\n        }\n\n        for(i = offset; i < l; i += stride) {\n            vec[0] = a[i]; vec[1] = a[i+1]; vec[2] = a[i+2];\n            fn(vec, vec, arg);\n            a[i] = vec[0]; a[i+1] = vec[1]; a[i+2] = vec[2];\n        }\n        \n        return a;\n    };\n})();\n\n/**\n * Get the angle between two 3D vectors\n * @param {vec3} a The first operand\n * @param {vec3} b The second operand\n * @returns {Number} The angle in radians\n */\nvec3.angle = function(a, b) {\n   \n    var tempA = vec3.fromValues(a[0], a[1], a[2]);\n    var tempB = vec3.fromValues(b[0], b[1], b[2]);\n \n    vec3.normalize(tempA, tempA);\n    vec3.normalize(tempB, tempB);\n \n    var cosine = vec3.dot(tempA, tempB);\n\n    if(cosine > 1.0){\n        return 0;\n    } else {\n        return Math.acos(cosine);\n    }     \n};\n\n/**\n * Returns a string representation of a vector\n *\n * @param {vec3} vec vector to represent as a string\n * @returns {String} string representation of the vector\n */\nvec3.str = function (a) {\n    return 'vec3(' + a[0] + ', ' + a[1] + ', ' + a[2] + ')';\n};\n\nif(typeof(exports) !== 'undefined') {\n    exports.vec3 = vec3;\n}\n";
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.assign", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.enum-keys"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      enumKeys = require("npm:core-js@0.9.10/library/modules/$.enum-keys");
  module.exports = Object.assign || function assign(target, source) {
    var T = Object($.assertDefined(target)),
        l = arguments.length,
        i = 1;
    while (l > i) {
      var S = $.ES5Object(arguments[i++]),
          keys = enumKeys(S),
          length = keys.length,
          j = 0,
          key;
      while (length > j)
        T[key = keys[j++]] = S[key];
    }
    return T;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.math", ["npm:core-js@0.9.10/library/modules/$.def"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var Infinity = 1 / 0,
      $def = require("npm:core-js@0.9.10/library/modules/$.def"),
      E = Math.E,
      pow = Math.pow,
      abs = Math.abs,
      exp = Math.exp,
      log = Math.log,
      sqrt = Math.sqrt,
      ceil = Math.ceil,
      floor = Math.floor,
      EPSILON = pow(2, -52),
      EPSILON32 = pow(2, -23),
      MAX32 = pow(2, 127) * (2 - EPSILON32),
      MIN32 = pow(2, -126);
  function roundTiesToEven(n) {
    return n + 1 / EPSILON - 1 / EPSILON;
  }
  function sign(x) {
    return (x = +x) == 0 || x != x ? x : x < 0 ? -1 : 1;
  }
  function asinh(x) {
    return !isFinite(x = +x) || x == 0 ? x : x < 0 ? -asinh(-x) : log(x + sqrt(x * x + 1));
  }
  function expm1(x) {
    return (x = +x) == 0 ? x : x > -1e-6 && x < 1e-6 ? x + x * x / 2 : exp(x) - 1;
  }
  $def($def.S, 'Math', {
    acosh: function acosh(x) {
      return (x = +x) < 1 ? NaN : isFinite(x) ? log(x / E + sqrt(x + 1) * sqrt(x - 1) / E) + 1 : x;
    },
    asinh: asinh,
    atanh: function atanh(x) {
      return (x = +x) == 0 ? x : log((1 + x) / (1 - x)) / 2;
    },
    cbrt: function cbrt(x) {
      return sign(x = +x) * pow(abs(x), 1 / 3);
    },
    clz32: function clz32(x) {
      return (x >>>= 0) ? 31 - floor(log(x + 0.5) * Math.LOG2E) : 32;
    },
    cosh: function cosh(x) {
      return (exp(x = +x) + exp(-x)) / 2;
    },
    expm1: expm1,
    fround: function fround(x) {
      var $abs = abs(x),
          $sign = sign(x),
          a,
          result;
      if ($abs < MIN32)
        return $sign * roundTiesToEven($abs / MIN32 / EPSILON32) * MIN32 * EPSILON32;
      a = (1 + EPSILON32 / EPSILON) * $abs;
      result = a - (a - $abs);
      if (result > MAX32 || result != result)
        return $sign * Infinity;
      return $sign * result;
    },
    hypot: function hypot(value1, value2) {
      var sum = 0,
          len1 = arguments.length,
          len2 = len1,
          args = Array(len1),
          larg = 0,
          arg;
      while (len1--) {
        arg = args[len1] = abs(arguments[len1]);
        if (arg == Infinity)
          return Infinity;
        if (arg > larg)
          larg = arg;
      }
      larg = larg || 1;
      while (len2--)
        sum += pow(args[len2] / larg, 2);
      return larg * sqrt(sum);
    },
    imul: function imul(x, y) {
      var UInt16 = 0xffff,
          xn = +x,
          yn = +y,
          xl = UInt16 & xn,
          yl = UInt16 & yn;
      return 0 | xl * yl + ((UInt16 & xn >>> 16) * yl + xl * (UInt16 & yn >>> 16) << 16 >>> 0);
    },
    log1p: function log1p(x) {
      return (x = +x) > -1e-8 && x < 1e-8 ? x - x * x / 2 : log(1 + x);
    },
    log10: function log10(x) {
      return log(x) / Math.LN10;
    },
    log2: function log2(x) {
      return log(x) / Math.LN2;
    },
    sign: sign,
    sinh: function sinh(x) {
      return abs(x = +x) < 1 ? (expm1(x) - expm1(-x)) / 2 : (exp(x - 1) - exp(-x - 1)) * (E / 2);
    },
    tanh: function tanh(x) {
      var a = expm1(x = +x),
          b = expm1(-x);
      return a == Infinity ? 1 : b == Infinity ? -1 : (a - b) / (exp(x) + exp(-x));
    },
    trunc: function trunc(it) {
      return (it > 0 ? floor : ceil)(it);
    }
  });
  global.define = __define;
  return module.exports;
});

System.register("github:maxdavidson/jsTGALoader@master/tga.js!github:systemjs/plugin-text@0.0.2", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = " /**\n * @fileoverview jsTGALoader - Javascript loader for TGA file\n * @author Vincent Thibault\n * @version 1.2.1\n * @blog http://blog.robrowser.com/javascript-tga-loader.html\n */\n\n/* Copyright (c) 2013, Vincent Thibault. All rights reserved.\n\nRedistribution and use in source and binary forms, with or without modification,\nare permitted provided that the following conditions are met:\n\n  * Redistributions of source code must retain the above copyright notice, this\n    list of conditions and the following disclaimer.\n  * Redistributions in binary form must reproduce the above copyright notice,\n    this list of conditions and the following disclaimer in the documentation \n    and/or other materials provided with the distribution.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\" AND\nANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED\nWARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE \nDISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR\nANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES\n(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;\nLOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON\nANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT\n(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS\nSOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */\n\n(function(_global)\n{\n\t'use strict';\n\n\n\t/**\n\t * TGA Namespace\n\t * @constructor\n\t */\n\tfunction Targa()\n\t{\n\t}\n\n\n\t/**\n\t * @var {object} TGA type constants\n\t */\n\tTarga.Type = {\n\t\tNO_DATA:      0,\n\t\tINDEXED:      1,\n\t\tRGB:          2,\n\t\tGREY:         3,\n\t\tRLE_INDEXED:  9,\n\t\tRLE_RGB:     10,\n\t\tRLE_GREY:    11\n\t};\n\n\n\t/**\n\t * @var {object} TGA origin constants\n\t */\n\tTarga.Origin = {\n\t\tBOTTOM_LEFT:  0x00,\n\t\tBOTTOM_RIGHT: 0x01,\n\t\tTOP_LEFT:     0x02,\n\t\tTOP_RIGHT:    0x03,\n\t\tSHIFT:        0x04,\n\t\tMASK:         0x30\n\t};\n\n\n\t/**\n\t * Check the header of TGA file to detect errors\n\t *\n\t * @param {object} tga header structure\n\t * @throws Error\n\t */\n\tfunction checkHeader( header )\n\t{\n\t\t// What the need of a file without data ?\n\t\tif (header.imageType === Targa.Type.NO_DATA) {\n\t\t\tthrow new Error('Targa::checkHeader() - No data');\n\t\t}\n\n\t\t// Indexed type\n\t\tif (header.hasColorMap) {\n\t\t\tif (header.colorMapLength > 256 || header.colorMapSize !== 24 || header.colorMapType !== 1) {\n\t\t\t\tthrow new Error('Targa::checkHeader() - Invalid colormap for indexed type');\n\t\t\t}\n\t\t}\n\t\telse {\n\t\t\tif (header.colorMapType) {\n\t\t\t\tthrow new Error('Targa::checkHeader() - Why does the image contain a palette ?');\n\t\t\t}\n\t\t}\n\n\t\t// Check image size\n\t\tif (header.width <= 0 || header.height <= 0) {\n\t\t\tthrow new Error('Targa::checkHeader() - Invalid image size');\n\t\t}\n\n\t\t// Check pixel size\n\t\tif (header.pixelDepth !== 8  &&\n\t\t    header.pixelDepth !== 16 &&\n\t\t    header.pixelDepth !== 24 &&\n\t\t    header.pixelDepth !== 32) {\n\t\t\tthrow new Error('Targa::checkHeader() - Invalid pixel size \"' + header.pixelDepth + '\"');\n\t\t}\n\t}\n\n\n\t/**\n\t * Decode RLE compression\n\t *\n\t * @param {Uint8Array} data\n\t * @param {number} offset in data to start loading RLE\n\t * @param {number} pixel count\n\t * @param {number} output buffer size\n\t */\n\tfunction decodeRLE( data, offset, pixelSize, outputSize)\n\t{\n\t\tvar pos, c, count, i;\n\t\tvar pixels, output;\n\n\t\toutput = new Uint8Array(outputSize);\n\t\tpixels = new Uint8Array(pixelSize);\n\t\tpos    = 0;\n\n\t\twhile (pos < outputSize) {\n\t\t\tc     = data[offset++];\n\t\t\tcount = (c & 0x7f) + 1;\n\n\t\t\t// RLE pixels.\n\t\t\tif (c & 0x80) {\n\t\t\t\t// Bind pixel tmp array\n\t\t\t\tfor (i = 0; i < pixelSize; ++i) {\n\t\t\t\t\tpixels[i] = data[offset++];\n\t\t\t\t}\n\n\t\t\t\t// Copy pixel array\n\t\t\t\tfor (i = 0; i < count; ++i) {\n\t\t\t\t\toutput.set(pixels, pos);\n\t\t\t\t\tpos += pixelSize;\n\t\t\t\t}\n\t\t\t}\n\n\t\t\t// Raw pixels.\n\t\t\telse {\n\t\t\t\tcount *= pixelSize;\n\t\t\t\tfor (i = 0; i < count; ++i) {\n\t\t\t\t\toutput[pos++] = data[offset++];\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\n\t\treturn output;\n\t}\n\n\n\t/**\n\t * Return a ImageData object from a TGA file (8bits)\n\t *\n\t * @param {Array} imageData - ImageData to bind\n\t * @param {Array} indexes - index to colormap\n\t * @param {Array} colormap\n\t * @param {number} width\n\t * @param {number} y_start - start at y pixel.\n\t * @param {number} x_start - start at x pixel.\n\t * @param {number} y_step  - increment y pixel each time.\n\t * @param {number} y_end   - stop at pixel y.\n\t * @param {number} x_step  - increment x pixel each time.\n\t * @param {number} x_end   - stop at pixel x.\n\t * @returns {Array} imageData\n\t */\n\tfunction getImageData8bits(imageData, indexes, colormap, width, y_start, y_step, y_end, x_start, x_step, x_end)\n\t{\n\t\tvar color, i, x, y;\n\n\t\tfor (i = 0, y = y_start; y !== y_end; y += y_step) {\n\t\t\tfor (x = x_start; x !== x_end; x += x_step, i++) {\n\t\t\t\tcolor = indexes[i];\n\t\t\t\timageData[(x + width * y) * 4 + 3] = 255;\n\t\t\t\timageData[(x + width * y) * 4 + 2] = colormap[(color * 3) + 0];\n\t\t\t\timageData[(x + width * y) * 4 + 1] = colormap[(color * 3) + 1];\n\t\t\t\timageData[(x + width * y) * 4 + 0] = colormap[(color * 3) + 2];\n\t\t\t}\n\t\t}\n\n\t\treturn imageData;\n\t}\n\n\n\t/**\n\t * Return a ImageData object from a TGA file (16bits)\n\t *\n\t * @param {Array} imageData - ImageData to bind\n\t * @param {Array} pixels data\n\t * @param {Array} colormap - not used\n\t * @param {number} width\n\t * @param {number} y_start - start at y pixel.\n\t * @param {number} x_start - start at x pixel.\n\t * @param {number} y_step  - increment y pixel each time.\n\t * @param {number} y_end   - stop at pixel y.\n\t * @param {number} x_step  - increment x pixel each time.\n\t * @param {number} x_end   - stop at pixel x.\n\t * @returns {Array} imageData\n\t */\n\tfunction getImageData16bits(imageData, pixels, colormap, width, y_start, y_step, y_end, x_start, x_step, x_end)\n\t{\n\t\tvar color, i, x, y;\n\n\t\tfor (i = 0, y = y_start; y !== y_end; y += y_step) {\n\t\t\tfor (x = x_start; x !== x_end; x += x_step, i += 2) {\n\t\t\t\tcolor = pixels[i + 0] | (pixels[i + 1] << 8);\n\t\t\t\timageData[(x + width * y) * 4 + 0] = (color & 0x7C00) >> 7;\n\t\t\t\timageData[(x + width * y) * 4 + 1] = (color & 0x03E0) >> 2;\n\t\t\t\timageData[(x + width * y) * 4 + 2] = (color & 0x001F) >> 3;\n\t\t\t\timageData[(x + width * y) * 4 + 3] = (color & 0x8000) ? 0 : 255;\n\t\t\t}\n\t\t}\n\n\t\treturn imageData;\n\t}\n\n\n\t/**\n\t * Return a ImageData object from a TGA file (24bits)\n\t *\n\t * @param {Array} imageData - ImageData to bind\n\t * @param {Array} pixels data\n\t * @param {Array} colormap - not used\n\t * @param {number} width\n\t * @param {number} y_start - start at y pixel.\n\t * @param {number} x_start - start at x pixel.\n\t * @param {number} y_step  - increment y pixel each time.\n\t * @param {number} y_end   - stop at pixel y.\n\t * @param {number} x_step  - increment x pixel each time.\n\t * @param {number} x_end   - stop at pixel x.\n\t * @returns {Array} imageData\n\t */\n\tfunction getImageData24bits(imageData, pixels, colormap, width, y_start, y_step, y_end, x_start, x_step, x_end)\n\t{\n\t\tvar i, x, y;\n\n\t\tfor (i = 0, y = y_start; y !== y_end; y += y_step) {\n\t\t\tfor (x = x_start; x !== x_end; x += x_step, i += 3) {\n\t\t\t\timageData[(x + width * y) * 4 + 3] = 255;\n\t\t\t\timageData[(x + width * y) * 4 + 2] = pixels[i + 0];\n\t\t\t\timageData[(x + width * y) * 4 + 1] = pixels[i + 1];\n\t\t\t\timageData[(x + width * y) * 4 + 0] = pixels[i + 2];\n\t\t\t}\n\t\t}\n\n\t\treturn imageData;\n\t}\n\n\n\t/**\n\t * Return a ImageData object from a TGA file (32bits)\n\t *\n\t * @param {Array} imageData - ImageData to bind\n\t * @param {Array} pixels data\n\t * @param {Array} colormap - not used\n\t * @param {number} width\n\t * @param {number} y_start - start at y pixel.\n\t * @param {number} x_start - start at x pixel.\n\t * @param {number} y_step  - increment y pixel each time.\n\t * @param {number} y_end   - stop at pixel y.\n\t * @param {number} x_step  - increment x pixel each time.\n\t * @param {number} x_end   - stop at pixel x.\n\t * @returns {Array} imageData\n\t */\n\tfunction getImageData32bits(imageData, pixels, colormap, width, y_start, y_step, y_end, x_start, x_step, x_end)\n\t{\n\t\tvar i, x, y;\n\n\t\tfor (i = 0, y = y_start; y !== y_end; y += y_step) {\n\t\t\tfor (x = x_start; x !== x_end; x += x_step, i += 4) {\n\t\t\t\timageData[(x + width * y) * 4 + 2] = pixels[i + 0];\n\t\t\t\timageData[(x + width * y) * 4 + 1] = pixels[i + 1];\n\t\t\t\timageData[(x + width * y) * 4 + 0] = pixels[i + 2];\n\t\t\t\timageData[(x + width * y) * 4 + 3] = pixels[i + 3];\n\t\t\t}\n\t\t}\n\n\t\treturn imageData;\n\t}\n\n\n\t/**\n\t * Return a ImageData object from a TGA file (8bits grey)\n\t *\n\t * @param {Array} imageData - ImageData to bind\n\t * @param {Array} pixels data\n\t * @param {Array} colormap - not used\n\t * @param {number} width\n\t * @param {number} y_start - start at y pixel.\n\t * @param {number} x_start - start at x pixel.\n\t * @param {number} y_step  - increment y pixel each time.\n\t * @param {number} y_end   - stop at pixel y.\n\t * @param {number} x_step  - increment x pixel each time.\n\t * @param {number} x_end   - stop at pixel x.\n\t * @returns {Array} imageData\n\t */\n\tfunction getImageDataGrey8bits(imageData, pixels, colormap, width, y_start, y_step, y_end, x_start, x_step, x_end)\n\t{\n\t\tvar color, i, x, y;\n\n\t\tfor (i = 0, y = y_start; y !== y_end; y += y_step) {\n\t\t\tfor (x = x_start; x !== x_end; x += x_step, i++) {\n\t\t\t\tcolor = pixels[i];\n\t\t\t\timageData[(x + width * y) * 4 + 0] = color;\n\t\t\t\timageData[(x + width * y) * 4 + 1] = color;\n\t\t\t\timageData[(x + width * y) * 4 + 2] = color;\n\t\t\t\timageData[(x + width * y) * 4 + 3] = 255;\n\t\t\t}\n\t\t}\n\n\t\treturn imageData;\n\t}\n\n\n\t/**\n\t * Return a ImageData object from a TGA file (16bits grey)\n\t *\n\t * @param {Array} imageData - ImageData to bind\n\t * @param {Array} pixels data\n\t * @param {Array} colormap - not used\n\t * @param {number} width\n\t * @param {number} y_start - start at y pixel.\n\t * @param {number} x_start - start at x pixel.\n\t * @param {number} y_step  - increment y pixel each time.\n\t * @param {number} y_end   - stop at pixel y.\n\t * @param {number} x_step  - increment x pixel each time.\n\t * @param {number} x_end   - stop at pixel x.\n\t * @returns {Array} imageData\n\t */\n\tfunction getImageDataGrey16bits(imageData, pixels, colormap, width, y_start, y_step, y_end, x_start, x_step, x_end)\n\t{\n\t\tvar i, x, y;\n\n\t\tfor (i = 0, y = y_start; y !== y_end; y += y_step) {\n\t\t\tfor (x = x_start; x !== x_end; x += x_step, i += 2) {\n\t\t\t\timageData[(x + width * y) * 4 + 0] = pixels[i + 0];\n\t\t\t\timageData[(x + width * y) * 4 + 1] = pixels[i + 0];\n\t\t\t\timageData[(x + width * y) * 4 + 2] = pixels[i + 0];\n\t\t\t\timageData[(x + width * y) * 4 + 3] = pixels[i + 1];\n\t\t\t}\n\t\t}\n\n\t\treturn imageData;\n\t}\n\n\n\t/**\n\t * Open a targa file using XHR, be aware with Cross Domain files...\n\t *\n\t * @param {string} path - Path of the filename to load\n\t * @param {function} callback - callback to trigger when the file is loaded\n\t */\n\tTarga.prototype.open = function targaOpen(path, callback)\n\t{\n\t\tvar req, tga = this;\n\t\treq = new XMLHttpRequest();\n\t\treq.open('GET', path, true);\n\t\treq.responseType = 'arraybuffer';\n\t\treq.onload = function() {\n\t\t\tif (this.status === 200) {\n\t\t\t\ttga.load(new Uint8Array(req.response));\n\t\t\t\tif (callback) {\n\t\t\t\t\tcallback.call(tga);\n\t\t\t\t}\n\t\t\t}\n\t\t};\n\t\treq.send(null);\n\t};\n\n\n\t/**\n\t * Load and parse a TGA file\n\t *\n\t * @param {Uint8Array} data - TGA file buffer array\n\t */\n\tTarga.prototype.load = function targaLoad( data )\n\t{\n\t\tvar offset = 0;\n\n\t\t// Not enough data to contain header ?\n\t\tif (data.length < 0x12) {\n\t\t\tthrow new Error('Targa::load() - Not enough data to contain header');\n\t\t}\n\n\t\t// Read TgaHeader\n\t\tthis.header = {\n\t\t\t/* 0x00  BYTE */  idLength:       data[offset++],\n\t\t\t/* 0x01  BYTE */  colorMapType:   data[offset++],\n\t\t\t/* 0x02  BYTE */  imageType:      data[offset++],\n\t\t\t/* 0x03  WORD */  colorMapIndex:  data[offset++] | data[offset++] << 8,\n\t\t\t/* 0x05  WORD */  colorMapLength: data[offset++] | data[offset++] << 8,\n\t\t\t/* 0x07  BYTE */  colorMapDepth:  data[offset++],\n\t\t\t/* 0x08  WORD */  offsetX:        data[offset++] | data[offset++] << 8,\n\t\t\t/* 0x0a  WORD */  offsetY:        data[offset++] | data[offset++] << 8,\n\t\t\t/* 0x0c  WORD */  width:          data[offset++] | data[offset++] << 8,\n\t\t\t/* 0x0e  WORD */  height:         data[offset++] | data[offset++] << 8,\n\t\t\t/* 0x10  BYTE */  pixelDepth:     data[offset++],\n\t\t\t/* 0x11  BYTE */  flags:          data[offset++]\n\t\t};\n\n\t\t// Set shortcut\n\t\tthis.header.hasEncoding = (this.header.imageType === Targa.Type.RLE_INDEXED || this.header.imageType === Targa.Type.RLE_RGB   || this.header.imageType === Targa.Type.RLE_GREY);\n\t\tthis.header.hasColorMap = (this.header.imageType === Targa.Type.RLE_INDEXED || this.header.imageType === Targa.Type.INDEXED);\n\t\tthis.header.isGreyColor = (this.header.imageType === Targa.Type.RLE_GREY    || this.header.imageType === Targa.Type.GREY);\n\n\t\t// Check if a valid TGA file (or if we can load it)\n\t\tcheckHeader(this.header);\n\n\t\t// Move to data\n\t\toffset += this.header.idLength;\n\t\tif (offset >= data.length) {\n\t\t\tthrow new Error('Targa::load() - No data');\n\t\t}\n\n\t\t// Read palette\n\t\tif (this.header.hasColorMap) {\n\t\t\tvar colorMapSize  = this.header.colorMapLength * (this.header.colorMapDepth >> 3);\n\t\t\tthis.palette      = data.subarray( offset, offset + colorMapSize);\n\t\t\toffset           += colorMapSize;\n\t\t}\n\n\t\tvar pixelSize  = this.header.pixelDepth >> 3;\n\t\tvar imageSize  = this.header.width * this.header.height;\n\t\tvar pixelTotal = imageSize * pixelSize;\n\n\t\t// RLE encoded\n\t\tif (this.header.hasEncoding) {\n\t\t\tthis.imageData = decodeRLE(data, offset, pixelSize, pixelTotal);\n\t\t}\n\n\t\t// RAW pixels\n\t\telse {\n\t\t\tthis.imageData = data.subarray( offset, offset + (this.header.hasColorMap ? imageSize : pixelTotal) );\n\t\t}\n\t};\n\n\n\t/**\n\t * Return a ImageData object from a TGA file\n\t *\n\t * @param {object} imageData - Optional ImageData to work with\n\t * @returns {object} imageData\n\t */\n\tTarga.prototype.getImageData = function targaGetImageData( imageData )\n\t{\n\t\tvar width  = this.header.width;\n\t\tvar height = this.header.height;\n\t\tvar origin = (this.header.flags & Targa.Origin.MASK) >> Targa.Origin.SHIFT;\n\t\tvar x_start, x_step, x_end, y_start, y_step, y_end;\n\t\tvar getImageData;\n\n\t\t\t// Create an imageData\n\t\tif (!imageData) {\n\t\t\tif (typeof(window) === 'object') {\n\t\t\t\timageData = document.createElement('canvas').getContext('2d').createImageData(width, height);\n\t\t\t}\n\t\t\t// In Thread context ?\n\t\t\telse {\n\t\t\t\timageData = {\n\t\t\t\t\twidth:  width,\n\t\t\t\t\theight: height,\n\t\t\t\t\tdata: new Uint8ClampedArray(width * height * 4)\n\t\t\t\t};\n\t\t\t}\n\t\t}\n\n\t\tif (origin === Targa.Origin.TOP_LEFT || origin === Targa.Origin.TOP_RIGHT) {\n\t\t\ty_start = 0;\n\t\t\ty_step  = 1;\n\t\t\ty_end   = height;\n\t\t}\n\t\telse {\n\t\t\ty_start = height - 1;\n\t\t\ty_step  = -1;\n\t\t\ty_end   = -1;\n\t\t}\n\n\t\tif (origin === Targa.Origin.TOP_LEFT || origin === Targa.Origin.BOTTOM_LEFT) {\n\t\t\tx_start = 0;\n\t\t\tx_step  = 1;\n\t\t\tx_end   = width;\n\t\t}\n\t\telse {\n\t\t\tx_start = width - 1;\n\t\t\tx_step  = -1;\n\t\t\tx_end   = -1;\n\t\t}\n\n\t\t// TODO: use this.header.offsetX and this.header.offsetY ?\n\n\t\tswitch (this.header.pixelDepth) {\n\t\t\tcase 8:\n\t\t\t\tgetImageData = this.header.isGreyColor ? getImageDataGrey8bits : getImageData8bits;\n\t\t\t\tbreak;\n\n\t\t\tcase 16:\n\t\t\t\tgetImageData = this.header.isGreyColor ? getImageDataGrey16bits : getImageData16bits;\n\t\t\t\tbreak;\n\n\t\t\tcase 24:\n\t\t\t\tgetImageData = getImageData24bits;\n\t\t\t\tbreak;\n\n\t\t\tcase 32:\n\t\t\t\tgetImageData = getImageData32bits;\n\t\t\t\tbreak;\n\t\t}\n\n\t\tgetImageData(imageData.data, this.imageData, this.palette, width, y_start, y_step, y_end, x_start, x_step, x_end);\n\t\treturn imageData;\n\t};\n\n\n\t/**\n\t * Return a canvas with the TGA render on it\n\t *\n\t * @returns {object} CanvasElement\n\t */\n\tTarga.prototype.getCanvas = function targaGetCanvas()\n\t{\n\t\tvar canvas, ctx, imageData;\n\n\t\tcanvas    = document.createElement('canvas');\n\t\tctx       = canvas.getContext('2d');\n\t\timageData = ctx.createImageData(this.header.width, this.header.height);\n\n\t\tcanvas.width  = this.header.width;\n\t\tcanvas.height = this.header.height;\n\n\t\tctx.putImageData(this.getImageData(imageData), 0, 0);\n\n\t\treturn canvas;\n\t};\n\n\n\t/**\n\t * Return a dataURI of the TGA file\n\t *\n\t * @param {string} type - Optional image content-type to output (default: image/png)\n\t * @returns {string} url\n\t */\n\tTarga.prototype.getDataURL = function targaGetDatURL( type )\n\t{\n\t\treturn this.getCanvas().toDataURL(type || 'image/png');\n\t};\n\n\n\t// Find Context\n\tvar shim = {};\n\tif (typeof(exports) === 'undefined') {\n\t\tif (typeof(define) === 'function' && typeof(define.amd) === 'object' && define.amd) {\n\t\t\tdefine(function(){\n\t\t\t\treturn Targa;\n\t\t\t});\n\t\t} else {\n\t\t\t// Browser\n\t\t\tshim.exports = typeof(window) !== 'undefined' ? window : _global;\n\t\t}\n\t} \n\telse {\n\t\t// Commonjs\n\t\tshim.exports = exports;\n\t}\n\n\n\t// Export\n\tif (shim.exports) {\n\t\tshim.exports.TGA = Targa;\n\t}\n\n})(this);\n";
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/object/freeze", ["npm:core-js@0.9.10/library/modules/es6.object.statics-accept-primitives", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.object.statics-accept-primitives");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.Object.freeze;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/helpers/object-without-properties", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  exports["default"] = function(obj, keys) {
    var target = {};
    for (var i in obj) {
      if (keys.indexOf(i) >= 0)
        continue;
      if (!Object.prototype.hasOwnProperty.call(obj, i))
        continue;
      target[i] = obj[i];
    }
    return target;
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

System.register("lib/material/shaders/phong.vert.dot!lib/plugins/dot", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function anonymous(it) {
    var out = 'uniform mat4 mvpMatrix;\nuniform mat4 modelMatrix;\nuniform mat3 normalMatrix;\n\nattribute vec3 vertex;\nattribute vec3 normal;\n';
    if (it.ambient === 'texture' || it.diffuse === 'texture' || it.specular === 'texture') {
      out += '\nattribute vec2 texcoord;\n';
    }
    out += '\n\nvarying vec3 worldFragPos;\nvarying vec3 worldNormal;\n\n';
    if (it.ambient === 'texture') {
      out += '\nuniform vec4 ambientTexcoordBounds;\nvarying vec2 ambientTexcoord;\n';
    }
    out += '\n\n';
    if (it.diffuse === 'texture') {
      out += '\nuniform vec4 diffuseTexcoordBounds;\nvarying vec2 diffuseTexcoord;\n';
    }
    out += '\n\n';
    if (it.specular === 'texture') {
      out += '\nuniform vec4 specularTexcoordBounds;\nvarying vec2 specularTexcoord;\n';
    }
    out += '\n\n\nvoid main() {\n\n    worldFragPos = vec3(modelMatrix * vec4(vertex, 1.0));\n    worldNormal = normalize(normalMatrix * normal);\n\n    ';
    if (it.ambient === 'texture') {
      out += '\n    ambientTexcoord = ambientTexcoordBounds.xy + texcoord * ambientTexcoordBounds.zw;\n    ';
    }
    out += '\n\n    ';
    if (it.diffuse === 'texture') {
      out += '\n    diffuseTexcoord = diffuseTexcoordBounds.xy + texcoord * diffuseTexcoordBounds.zw;\n    ';
    }
    out += '\n\n    ';
    if (it.specular === 'texture') {
      out += '\n    specularTexcoord = specularTexcoordBounds.xy + texcoord * specularTexcoordBounds.zw;\n    ';
    }
    out += '\n\n    gl_Position = mvpMatrix * vec4(vertex, 1.0);\n}\n';
    return out;
  };
  global.define = __define;
  return module.exports;
});

System.register("lib/material/shaders/phong.frag.dot!lib/plugins/dot", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function anonymous(it) {
    var out = '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nprecision mediump float;\n\nstruct DirectionalLight {\n    vec3  direction;\n    vec3  diffuse, specular;\n};\n\nstruct PointLight {\n    vec3  position;\n    vec3  diffuse, specular;\n    float constant, linear, quadratic;\n};\n\nstruct SpotLight {\n    vec3  position, direction;\n    vec3  diffuse, specular;\n    float cutoff, outerCutoff;\n    float constant, linear, quadratic;\n};\n\nstruct Material {\n    lowp float shininess;\n    ';
    if (it.ambient === 'static') {
      out += ' vec3 ambient; ';
    }
    out += '\n    ';
    if (it.diffuse === 'static') {
      out += ' vec3 diffuse; ';
    }
    out += '\n    ';
    if (it.specular === 'static') {
      out += ' vec3 specular; ';
    }
    out += '\n};\n\n\nvarying vec3 worldFragPos;\nvarying vec3 worldNormal;\n\nuniform vec3 viewPos;\n\n';
    if (it.ambient === 'texture') {
      out += '\nuniform sampler2D ambientSampler;\nvarying vec2 ambientTexcoord;\n';
    }
    out += '\n\n';
    if (it.diffuse === 'texture') {
      out += '\nuniform sampler2D diffuseSampler;\nvarying vec2 diffuseTexcoord;\n';
    }
    out += '\n\n';
    if (it.specular === 'texture') {
      out += '\nuniform sampler2D specularSampler;\nvarying vec2 specularTexcoord;\n';
    }
    out += '\n\n';
    if (it.MAX_DIRECTIONAL_LIGHTS) {
      out += '\n    uniform DirectionalLight directionalLights[' + (it.MAX_DIRECTIONAL_LIGHTS) + '];\n';
    }
    out += '\n\n';
    if (it.MAX_POINT_LIGHTS) {
      out += '\n    uniform PointLight pointLights[' + (it.MAX_POINT_LIGHTS) + '];\n';
    }
    out += '\n\n';
    if (it.MAX_SPOT_LIGHTS) {
      out += '\n    uniform SpotLight spotLights[' + (it.MAX_SPOT_LIGHTS) + '];\n';
    }
    out += '\n\nuniform Material material;\nuniform vec3 environmentAmbient;\n\nvoid main() {\n\n    vec3 worldNormal2 = normalize(worldNormal);\n\n    // Direction from fragment to camera\n    vec3 viewDir = normalize(viewPos - worldFragPos);\n    vec3 color = environmentAmbient +  ';
    if (it.ambient === 'texture') {
      out += ' texture2D(ambientSampler, ambientTexcoord).stp ';
    } else {
      out += ' material.ambient ';
    }
    out += ' ;\n\n    ';
    if (it.MAX_DIRECTIONAL_LIGHTS) {
      out += '\n        for (int i = 0; i < ' + (it.MAX_DIRECTIONAL_LIGHTS) + '; ++i) {\n            DirectionalLight light = directionalLights[i];\n            \n    vec3 lightDir = -light.direction;\n\n    \n\n    vec3 diffuse = light.diffuse *  ';
      if (it.diffuse === 'texture') {
        out += ' texture2D(diffuseSampler, diffuseTexcoord).stp ';
      } else {
        out += ' material.diffuse ';
      }
      out += '  * max(dot(worldNormal2, lightDir), 0.0);\n\n    //vec3 halfDir = normalize(lightDir + viewDir);\n    //vec3 specular = light.specular *  ';
      if (it.specular === 'texture') {
        out += ' texture2D(specularSampler, specularTexcoord).stp ';
      } else {
        out += ' material.specular ';
      }
      out += '  * pow(max(dot(halfDir, worldNormal2), 0.0), material.shininess);\n\n    vec3 reflectDir = reflect(-lightDir, worldNormal2);\n    vec3 specular = light.specular *  ';
      if (it.specular === 'texture') {
        out += ' texture2D(specularSampler, specularTexcoord).stp ';
      } else {
        out += ' material.specular ';
      }
      out += '  * pow(max(dot(viewDir, reflectDir), 0.0), material.shininess);\n\n    vec3 shade = diffuse + specular;\n\n\n            color += shade;\n        }\n    ';
    }
    out += '\n\n    ';
    if (it.MAX_POINT_LIGHTS) {
      out += '\n        for (int i = 0; i < ' + (it.MAX_POINT_LIGHTS) + '; ++i) {\n            PointLight light = pointLights[i];\n            \n    vec3 direction = light.position - worldFragPos;\n    float distance = length(direction);\n\n    vec3 lightDir = direction / distance;\n\n    \n\n    vec3 diffuse = light.diffuse *  ';
      if (it.diffuse === 'texture') {
        out += ' texture2D(diffuseSampler, diffuseTexcoord).stp ';
      } else {
        out += ' material.diffuse ';
      }
      out += '  * max(dot(worldNormal2, lightDir), 0.0);\n\n    //vec3 halfDir = normalize(lightDir + viewDir);\n    //vec3 specular = light.specular *  ';
      if (it.specular === 'texture') {
        out += ' texture2D(specularSampler, specularTexcoord).stp ';
      } else {
        out += ' material.specular ';
      }
      out += '  * pow(max(dot(halfDir, worldNormal2), 0.0), material.shininess);\n\n    vec3 reflectDir = reflect(-lightDir, worldNormal2);\n    vec3 specular = light.specular *  ';
      if (it.specular === 'texture') {
        out += ' texture2D(specularSampler, specularTexcoord).stp ';
      } else {
        out += ' material.specular ';
      }
      out += '  * pow(max(dot(viewDir, reflectDir), 0.0), material.shininess);\n\n    vec3 shade = diffuse + specular;\n\n\n    float attenuation = 1.0 / (light.constant + distance * (light.linear + distance * light.quadratic));\n\n    shade += attenuation;\n\n            color += shade;\n        }\n    ';
    }
    out += '\n\n    ';
    if (it.MAX_SPOT_LIGHTS) {
      out += '\n        for (int i = 0; i < ' + (it.MAX_SPOT_LIGHTS) + '; ++i) {\n            SpotLight light = spotLights[i];\n            \n    \n    vec3 direction = light.position - worldFragPos;\n    float distance = length(direction);\n\n    vec3 lightDir = direction / distance;\n\n    \n\n    vec3 diffuse = light.diffuse *  ';
      if (it.diffuse === 'texture') {
        out += ' texture2D(diffuseSampler, diffuseTexcoord).stp ';
      } else {
        out += ' material.diffuse ';
      }
      out += '  * max(dot(worldNormal2, lightDir), 0.0);\n\n    //vec3 halfDir = normalize(lightDir + viewDir);\n    //vec3 specular = light.specular *  ';
      if (it.specular === 'texture') {
        out += ' texture2D(specularSampler, specularTexcoord).stp ';
      } else {
        out += ' material.specular ';
      }
      out += '  * pow(max(dot(halfDir, worldNormal2), 0.0), material.shininess);\n\n    vec3 reflectDir = reflect(-lightDir, worldNormal2);\n    vec3 specular = light.specular *  ';
      if (it.specular === 'texture') {
        out += ' texture2D(specularSampler, specularTexcoord).stp ';
      } else {
        out += ' material.specular ';
      }
      out += '  * pow(max(dot(viewDir, reflectDir), 0.0), material.shininess);\n\n    vec3 shade = diffuse + specular;\n\n\n    float attenuation = 1.0 / (light.constant + distance * (light.linear + distance * light.quadratic));\n\n    shade += attenuation;\n\n\n    float theta = dot(lightDir, light.direction);\n    float epsilon = light.cutoff - light.outerCutoff;\n    float intensity = clamp((theta - light.outerCutoff) / epsilon, 0.0, 1.0);\n\n    shade *= intensity;\n\n            color += shade;\n        }\n    ';
    }
    out += '\n\n    gl_FragColor = vec4(color, 1.0);\n}\n';
    return out;
  };
  global.define = __define;
  return module.exports;
});

(function() {
function define(){};  define.amd = {};
(function() {
  var Bacon,
      BufferingSource,
      Bus,
      CompositeUnsubscribe,
      ConsumingSource,
      Desc,
      Dispatcher,
      End,
      Error,
      Event,
      EventStream,
      Exception,
      Initial,
      Next,
      None,
      Observable,
      Property,
      PropertyDispatcher,
      Some,
      Source,
      UpdateBarrier,
      _,
      addPropertyInitValueToStream,
      assert,
      assertArray,
      assertEventStream,
      assertFunction,
      assertNoArguments,
      assertObservable,
      assertObservableIsProperty,
      assertString,
      cloneArray,
      constantToFunction,
      containsDuplicateDeps,
      convertArgsToFunction,
      describe,
      endEvent,
      eventIdCounter,
      eventMethods,
      findDeps,
      findHandlerMethods,
      flatMap_,
      former,
      idCounter,
      initialEvent,
      isArray,
      isFieldKey,
      isObservable,
      latter,
      liftCallback,
      makeFunction,
      makeFunctionArgs,
      makeFunction_,
      makeObservable,
      makeSpawner,
      nextEvent,
      nop,
      partiallyApplied,
      recursionDepth,
      ref,
      registerObs,
      spys,
      toCombinator,
      toEvent,
      toFieldExtractor,
      toFieldKey,
      toOption,
      toSimpleExtractor,
      valueAndEnd,
      withDescription,
      withMethodCallSupport,
      hasProp = {}.hasOwnProperty,
      extend = function(child, parent) {
        for (var key in parent) {
          if (hasProp.call(parent, key))
            child[key] = parent[key];
        }
        function ctor() {
          this.constructor = child;
        }
        ctor.prototype = parent.prototype;
        child.prototype = new ctor();
        child.__super__ = parent.prototype;
        return child;
      },
      slice = [].slice,
      bind = function(fn, me) {
        return function() {
          return fn.apply(me, arguments);
        };
      };
  Bacon = {toString: function() {
      return "Bacon";
    }};
  Bacon.version = '0.7.58';
  Exception = (typeof global !== "undefined" && global !== null ? global : this).Error;
  nop = function() {};
  latter = function(_, x) {
    return x;
  };
  former = function(x, _) {
    return x;
  };
  cloneArray = function(xs) {
    return xs.slice(0);
  };
  assert = function(message, condition) {
    if (!condition) {
      throw new Exception(message);
    }
  };
  assertObservableIsProperty = function(x) {
    if (x instanceof Observable && !(x instanceof Property)) {
      throw new Exception("Observable is not a Property : " + x);
    }
  };
  assertEventStream = function(event) {
    if (!(event instanceof EventStream)) {
      throw new Exception("not an EventStream : " + event);
    }
  };
  assertObservable = function(event) {
    if (!(event instanceof Observable)) {
      throw new Exception("not an Observable : " + event);
    }
  };
  assertFunction = function(f) {
    return assert("not a function : " + f, _.isFunction(f));
  };
  isArray = function(xs) {
    return xs instanceof Array;
  };
  isObservable = function(x) {
    return x instanceof Observable;
  };
  assertArray = function(xs) {
    if (!isArray(xs)) {
      throw new Exception("not an array : " + xs);
    }
  };
  assertNoArguments = function(args) {
    return assert("no arguments supported", args.length === 0);
  };
  assertString = function(x) {
    if (typeof x !== "string") {
      throw new Exception("not a string : " + x);
    }
  };
  _ = {
    indexOf: Array.prototype.indexOf ? function(xs, x) {
      return xs.indexOf(x);
    } : function(xs, x) {
      var i,
          j,
          len1,
          y;
      for (i = j = 0, len1 = xs.length; j < len1; i = ++j) {
        y = xs[i];
        if (x === y) {
          return i;
        }
      }
      return -1;
    },
    indexWhere: function(xs, f) {
      var i,
          j,
          len1,
          y;
      for (i = j = 0, len1 = xs.length; j < len1; i = ++j) {
        y = xs[i];
        if (f(y)) {
          return i;
        }
      }
      return -1;
    },
    head: function(xs) {
      return xs[0];
    },
    always: function(x) {
      return function() {
        return x;
      };
    },
    negate: function(f) {
      return function(x) {
        return !f(x);
      };
    },
    empty: function(xs) {
      return xs.length === 0;
    },
    tail: function(xs) {
      return xs.slice(1, xs.length);
    },
    filter: function(f, xs) {
      var filtered,
          j,
          len1,
          x;
      filtered = [];
      for (j = 0, len1 = xs.length; j < len1; j++) {
        x = xs[j];
        if (f(x)) {
          filtered.push(x);
        }
      }
      return filtered;
    },
    map: function(f, xs) {
      var j,
          len1,
          results,
          x;
      results = [];
      for (j = 0, len1 = xs.length; j < len1; j++) {
        x = xs[j];
        results.push(f(x));
      }
      return results;
    },
    each: function(xs, f) {
      var key,
          value;
      for (key in xs) {
        value = xs[key];
        f(key, value);
      }
      return void 0;
    },
    toArray: function(xs) {
      if (isArray(xs)) {
        return xs;
      } else {
        return [xs];
      }
    },
    contains: function(xs, x) {
      return _.indexOf(xs, x) !== -1;
    },
    id: function(x) {
      return x;
    },
    last: function(xs) {
      return xs[xs.length - 1];
    },
    all: function(xs, f) {
      var j,
          len1,
          x;
      if (f == null) {
        f = _.id;
      }
      for (j = 0, len1 = xs.length; j < len1; j++) {
        x = xs[j];
        if (!f(x)) {
          return false;
        }
      }
      return true;
    },
    any: function(xs, f) {
      var j,
          len1,
          x;
      if (f == null) {
        f = _.id;
      }
      for (j = 0, len1 = xs.length; j < len1; j++) {
        x = xs[j];
        if (f(x)) {
          return true;
        }
      }
      return false;
    },
    without: function(x, xs) {
      return _.filter((function(y) {
        return y !== x;
      }), xs);
    },
    remove: function(x, xs) {
      var i;
      i = _.indexOf(xs, x);
      if (i >= 0) {
        return xs.splice(i, 1);
      }
    },
    fold: function(xs, seed, f) {
      var j,
          len1,
          x;
      for (j = 0, len1 = xs.length; j < len1; j++) {
        x = xs[j];
        seed = f(seed, x);
      }
      return seed;
    },
    flatMap: function(f, xs) {
      return _.fold(xs, [], (function(ys, x) {
        return ys.concat(f(x));
      }));
    },
    cached: function(f) {
      var value;
      value = None;
      return function() {
        if (value === None) {
          value = f();
          f = void 0;
        }
        return value;
      };
    },
    isFunction: function(f) {
      return typeof f === "function";
    },
    toString: function(obj) {
      var ex,
          internals,
          key,
          value;
      try {
        recursionDepth++;
        if (obj == null) {
          return "undefined";
        } else if (_.isFunction(obj)) {
          return "function";
        } else if (isArray(obj)) {
          if (recursionDepth > 5) {
            return "[..]";
          }
          return "[" + _.map(_.toString, obj).toString() + "]";
        } else if (((obj != null ? obj.toString : void 0) != null) && obj.toString !== Object.prototype.toString) {
          return obj.toString();
        } else if (typeof obj === "object") {
          if (recursionDepth > 5) {
            return "{..}";
          }
          internals = (function() {
            var results;
            results = [];
            for (key in obj) {
              if (!hasProp.call(obj, key))
                continue;
              value = (function() {
                try {
                  return obj[key];
                } catch (_error) {
                  ex = _error;
                  return ex;
                }
              })();
              results.push(_.toString(key) + ":" + _.toString(value));
            }
            return results;
          })();
          return "{" + internals + "}";
        } else {
          return obj;
        }
      } finally {
        recursionDepth--;
      }
    }
  };
  recursionDepth = 0;
  Bacon._ = _;
  UpdateBarrier = Bacon.UpdateBarrier = (function() {
    var afterTransaction,
        afters,
        aftersIndex,
        currentEventId,
        flush,
        flushDepsOf,
        flushWaiters,
        hasWaiters,
        inTransaction,
        rootEvent,
        waiterObs,
        waiters,
        whenDoneWith,
        wrappedSubscribe;
    rootEvent = void 0;
    waiterObs = [];
    waiters = {};
    afters = [];
    aftersIndex = 0;
    afterTransaction = function(f) {
      if (rootEvent) {
        return afters.push(f);
      } else {
        return f();
      }
    };
    whenDoneWith = function(obs, f) {
      var obsWaiters;
      if (rootEvent) {
        obsWaiters = waiters[obs.id];
        if (obsWaiters == null) {
          obsWaiters = waiters[obs.id] = [f];
          return waiterObs.push(obs);
        } else {
          return obsWaiters.push(f);
        }
      } else {
        return f();
      }
    };
    flush = function() {
      while (waiterObs.length > 0) {
        flushWaiters(0);
      }
      return void 0;
    };
    flushWaiters = function(index) {
      var f,
          j,
          len1,
          obs,
          obsId,
          obsWaiters;
      obs = waiterObs[index];
      obsId = obs.id;
      obsWaiters = waiters[obsId];
      waiterObs.splice(index, 1);
      delete waiters[obsId];
      flushDepsOf(obs);
      for (j = 0, len1 = obsWaiters.length; j < len1; j++) {
        f = obsWaiters[j];
        f();
      }
      return void 0;
    };
    flushDepsOf = function(obs) {
      var dep,
          deps,
          index,
          j,
          len1;
      deps = obs.internalDeps();
      for (j = 0, len1 = deps.length; j < len1; j++) {
        dep = deps[j];
        flushDepsOf(dep);
        if (waiters[dep.id]) {
          index = _.indexOf(waiterObs, dep);
          flushWaiters(index);
        }
      }
      return void 0;
    };
    inTransaction = function(event, context, f, args) {
      var after,
          result;
      if (rootEvent) {
        return f.apply(context, args);
      } else {
        rootEvent = event;
        try {
          result = f.apply(context, args);
          flush();
        } finally {
          rootEvent = void 0;
          while (aftersIndex < afters.length) {
            after = afters[aftersIndex];
            aftersIndex++;
            after();
          }
          aftersIndex = 0;
          afters = [];
        }
        return result;
      }
    };
    currentEventId = function() {
      if (rootEvent) {
        return rootEvent.id;
      } else {
        return void 0;
      }
    };
    wrappedSubscribe = function(obs, sink) {
      var doUnsub,
          shouldUnsub,
          unsub,
          unsubd;
      unsubd = false;
      shouldUnsub = false;
      doUnsub = function() {
        return shouldUnsub = true;
      };
      unsub = function() {
        unsubd = true;
        return doUnsub();
      };
      doUnsub = obs.dispatcher.subscribe(function(event) {
        return afterTransaction(function() {
          var reply;
          if (!unsubd) {
            reply = sink(event);
            if (reply === Bacon.noMore) {
              return unsub();
            }
          }
        });
      });
      if (shouldUnsub) {
        doUnsub();
      }
      return unsub;
    };
    hasWaiters = function() {
      return waiterObs.length > 0;
    };
    return {
      whenDoneWith: whenDoneWith,
      hasWaiters: hasWaiters,
      inTransaction: inTransaction,
      currentEventId: currentEventId,
      wrappedSubscribe: wrappedSubscribe,
      afterTransaction: afterTransaction
    };
  })();
  Source = (function() {
    function Source(obs1, sync, lazy1) {
      this.obs = obs1;
      this.sync = sync;
      this.lazy = lazy1 != null ? lazy1 : false;
      this.queue = [];
    }
    Source.prototype.subscribe = function(sink) {
      return this.obs.dispatcher.subscribe(sink);
    };
    Source.prototype.toString = function() {
      return this.obs.toString();
    };
    Source.prototype.markEnded = function() {
      return this.ended = true;
    };
    Source.prototype.consume = function() {
      if (this.lazy) {
        return {value: _.always(this.queue[0])};
      } else {
        return this.queue[0];
      }
    };
    Source.prototype.push = function(x) {
      return this.queue = [x];
    };
    Source.prototype.mayHave = function() {
      return true;
    };
    Source.prototype.hasAtLeast = function() {
      return this.queue.length;
    };
    Source.prototype.flatten = true;
    return Source;
  })();
  ConsumingSource = (function(superClass) {
    extend(ConsumingSource, superClass);
    function ConsumingSource() {
      return ConsumingSource.__super__.constructor.apply(this, arguments);
    }
    ConsumingSource.prototype.consume = function() {
      return this.queue.shift();
    };
    ConsumingSource.prototype.push = function(x) {
      return this.queue.push(x);
    };
    ConsumingSource.prototype.mayHave = function(c) {
      return !this.ended || this.queue.length >= c;
    };
    ConsumingSource.prototype.hasAtLeast = function(c) {
      return this.queue.length >= c;
    };
    ConsumingSource.prototype.flatten = false;
    return ConsumingSource;
  })(Source);
  BufferingSource = (function(superClass) {
    extend(BufferingSource, superClass);
    function BufferingSource(obs) {
      BufferingSource.__super__.constructor.call(this, obs, true);
    }
    BufferingSource.prototype.consume = function() {
      var values;
      values = this.queue;
      this.queue = [];
      return {value: function() {
          return values;
        }};
    };
    BufferingSource.prototype.push = function(x) {
      return this.queue.push(x.value());
    };
    BufferingSource.prototype.hasAtLeast = function() {
      return true;
    };
    return BufferingSource;
  })(Source);
  Source.isTrigger = function(s) {
    if (s instanceof Source) {
      return s.sync;
    } else {
      return s instanceof EventStream;
    }
  };
  Source.fromObservable = function(s) {
    if (s instanceof Source) {
      return s;
    } else if (s instanceof Property) {
      return new Source(s, false);
    } else {
      return new ConsumingSource(s, true);
    }
  };
  Desc = (function() {
    function Desc(context1, method1, args1) {
      this.context = context1;
      this.method = method1;
      this.args = args1;
      this.cached = void 0;
    }
    Desc.prototype.deps = function() {
      return this.cached || (this.cached = findDeps([this.context].concat(this.args)));
    };
    Desc.prototype.apply = function(obs) {
      obs.desc = this;
      return obs;
    };
    Desc.prototype.toString = function() {
      return _.toString(this.context) + "." + _.toString(this.method) + "(" + _.map(_.toString, this.args) + ")";
    };
    return Desc;
  })();
  describe = function() {
    var args,
        context,
        method;
    context = arguments[0], method = arguments[1], args = 3 <= arguments.length ? slice.call(arguments, 2) : [];
    if ((context || method) instanceof Desc) {
      return context || method;
    } else {
      return new Desc(context, method, args);
    }
  };
  withDescription = function() {
    var desc,
        j,
        obs;
    desc = 2 <= arguments.length ? slice.call(arguments, 0, j = arguments.length - 1) : (j = 0, []), obs = arguments[j++];
    return describe.apply(null, desc).apply(obs);
  };
  findDeps = function(x) {
    if (isArray(x)) {
      return _.flatMap(findDeps, x);
    } else if (isObservable(x)) {
      return [x];
    } else if (x instanceof Source) {
      return [x.obs];
    } else {
      return [];
    }
  };
  withMethodCallSupport = function(wrapped) {
    return function() {
      var args,
          context,
          f,
          methodName;
      f = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
      if (typeof f === "object" && args.length) {
        context = f;
        methodName = args[0];
        f = function() {
          return context[methodName].apply(context, arguments);
        };
        args = args.slice(1);
      }
      return wrapped.apply(null, [f].concat(slice.call(args)));
    };
  };
  makeFunctionArgs = function(args) {
    args = Array.prototype.slice.call(args);
    return makeFunction_.apply(null, args);
  };
  partiallyApplied = function(f, applied) {
    return function() {
      var args;
      args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
      return f.apply(null, applied.concat(args));
    };
  };
  toSimpleExtractor = function(args) {
    return function(key) {
      return function(value) {
        var fieldValue;
        if (value == null) {
          return void 0;
        } else {
          fieldValue = value[key];
          if (_.isFunction(fieldValue)) {
            return fieldValue.apply(value, args);
          } else {
            return fieldValue;
          }
        }
      };
    };
  };
  toFieldExtractor = function(f, args) {
    var partFuncs,
        parts;
    parts = f.slice(1).split(".");
    partFuncs = _.map(toSimpleExtractor(args), parts);
    return function(value) {
      var j,
          len1;
      for (j = 0, len1 = partFuncs.length; j < len1; j++) {
        f = partFuncs[j];
        value = f(value);
      }
      return value;
    };
  };
  isFieldKey = function(f) {
    return (typeof f === "string") && f.length > 1 && f.charAt(0) === ".";
  };
  makeFunction_ = withMethodCallSupport(function() {
    var args,
        f;
    f = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    if (_.isFunction(f)) {
      if (args.length) {
        return partiallyApplied(f, args);
      } else {
        return f;
      }
    } else if (isFieldKey(f)) {
      return toFieldExtractor(f, args);
    } else {
      return _.always(f);
    }
  });
  makeFunction = function(f, args) {
    return makeFunction_.apply(null, [f].concat(slice.call(args)));
  };
  convertArgsToFunction = function(obs, f, args, method) {
    var sampled;
    if (f instanceof Property) {
      sampled = f.sampledBy(obs, function(p, s) {
        return [p, s];
      });
      return method.call(sampled, function(arg) {
        var p,
            s;
        p = arg[0], s = arg[1];
        return p;
      }).map(function(arg) {
        var p,
            s;
        p = arg[0], s = arg[1];
        return s;
      });
    } else {
      f = makeFunction(f, args);
      return method.call(obs, f);
    }
  };
  toCombinator = function(f) {
    var key;
    if (_.isFunction(f)) {
      return f;
    } else if (isFieldKey(f)) {
      key = toFieldKey(f);
      return function(left, right) {
        return left[key](right);
      };
    } else {
      throw new Exception("not a function or a field key: " + f);
    }
  };
  toFieldKey = function(f) {
    return f.slice(1);
  };
  Some = (function() {
    function Some(value1) {
      this.value = value1;
    }
    Some.prototype.getOrElse = function() {
      return this.value;
    };
    Some.prototype.get = function() {
      return this.value;
    };
    Some.prototype.filter = function(f) {
      if (f(this.value)) {
        return new Some(this.value);
      } else {
        return None;
      }
    };
    Some.prototype.map = function(f) {
      return new Some(f(this.value));
    };
    Some.prototype.forEach = function(f) {
      return f(this.value);
    };
    Some.prototype.isDefined = true;
    Some.prototype.toArray = function() {
      return [this.value];
    };
    Some.prototype.inspect = function() {
      return "Some(" + this.value + ")";
    };
    Some.prototype.toString = function() {
      return this.inspect();
    };
    return Some;
  })();
  None = {
    getOrElse: function(value) {
      return value;
    },
    filter: function() {
      return None;
    },
    map: function() {
      return None;
    },
    forEach: function() {},
    isDefined: false,
    toArray: function() {
      return [];
    },
    inspect: function() {
      return "None";
    },
    toString: function() {
      return this.inspect();
    }
  };
  toOption = function(v) {
    if (v instanceof Some || v === None) {
      return v;
    } else {
      return new Some(v);
    }
  };
  Bacon.noMore = ["<no-more>"];
  Bacon.more = ["<more>"];
  eventIdCounter = 0;
  Event = (function() {
    function Event() {
      this.id = ++eventIdCounter;
    }
    Event.prototype.isEvent = function() {
      return true;
    };
    Event.prototype.isEnd = function() {
      return false;
    };
    Event.prototype.isInitial = function() {
      return false;
    };
    Event.prototype.isNext = function() {
      return false;
    };
    Event.prototype.isError = function() {
      return false;
    };
    Event.prototype.hasValue = function() {
      return false;
    };
    Event.prototype.filter = function() {
      return true;
    };
    Event.prototype.inspect = function() {
      return this.toString();
    };
    Event.prototype.log = function() {
      return this.toString();
    };
    return Event;
  })();
  Next = (function(superClass) {
    extend(Next, superClass);
    function Next(valueF, eager) {
      Next.__super__.constructor.call(this);
      if (!eager && _.isFunction(valueF) || valueF instanceof Next) {
        this.valueF = valueF;
        this.valueInternal = void 0;
      } else {
        this.valueF = void 0;
        this.valueInternal = valueF;
      }
    }
    Next.prototype.isNext = function() {
      return true;
    };
    Next.prototype.hasValue = function() {
      return true;
    };
    Next.prototype.value = function() {
      if (this.valueF instanceof Next) {
        this.valueInternal = this.valueF.value();
        this.valueF = void 0;
      } else if (this.valueF) {
        this.valueInternal = this.valueF();
        this.valueF = void 0;
      }
      return this.valueInternal;
    };
    Next.prototype.fmap = function(f) {
      var event,
          value;
      if (this.valueInternal) {
        value = this.valueInternal;
        return this.apply(function() {
          return f(value);
        });
      } else {
        event = this;
        return this.apply(function() {
          return f(event.value());
        });
      }
    };
    Next.prototype.apply = function(value) {
      return new Next(value);
    };
    Next.prototype.filter = function(f) {
      return f(this.value());
    };
    Next.prototype.toString = function() {
      return _.toString(this.value());
    };
    Next.prototype.log = function() {
      return this.value();
    };
    return Next;
  })(Event);
  Initial = (function(superClass) {
    extend(Initial, superClass);
    function Initial() {
      return Initial.__super__.constructor.apply(this, arguments);
    }
    Initial.prototype.isInitial = function() {
      return true;
    };
    Initial.prototype.isNext = function() {
      return false;
    };
    Initial.prototype.apply = function(value) {
      return new Initial(value);
    };
    Initial.prototype.toNext = function() {
      return new Next(this);
    };
    return Initial;
  })(Next);
  End = (function(superClass) {
    extend(End, superClass);
    function End() {
      return End.__super__.constructor.apply(this, arguments);
    }
    End.prototype.isEnd = function() {
      return true;
    };
    End.prototype.fmap = function() {
      return this;
    };
    End.prototype.apply = function() {
      return this;
    };
    End.prototype.toString = function() {
      return "<end>";
    };
    return End;
  })(Event);
  Error = (function(superClass) {
    extend(Error, superClass);
    function Error(error1) {
      this.error = error1;
    }
    Error.prototype.isError = function() {
      return true;
    };
    Error.prototype.fmap = function() {
      return this;
    };
    Error.prototype.apply = function() {
      return this;
    };
    Error.prototype.toString = function() {
      return "<error> " + _.toString(this.error);
    };
    return Error;
  })(Event);
  Bacon.Event = Event;
  Bacon.Initial = Initial;
  Bacon.Next = Next;
  Bacon.End = End;
  Bacon.Error = Error;
  initialEvent = function(value) {
    return new Initial(value, true);
  };
  nextEvent = function(value) {
    return new Next(value, true);
  };
  endEvent = function() {
    return new End();
  };
  toEvent = function(x) {
    if (x instanceof Event) {
      return x;
    } else {
      return nextEvent(x);
    }
  };
  idCounter = 0;
  registerObs = function() {};
  Observable = (function() {
    function Observable(desc) {
      this.id = ++idCounter;
      withDescription(desc, this);
      this.initialDesc = this.desc;
    }
    Observable.prototype.subscribe = function(sink) {
      return UpdateBarrier.wrappedSubscribe(this, sink);
    };
    Observable.prototype.subscribeInternal = function(sink) {
      return this.dispatcher.subscribe(sink);
    };
    Observable.prototype.onValue = function() {
      var f;
      f = makeFunctionArgs(arguments);
      return this.subscribe(function(event) {
        if (event.hasValue()) {
          return f(event.value());
        }
      });
    };
    Observable.prototype.onValues = function(f) {
      return this.onValue(function(args) {
        return f.apply(null, args);
      });
    };
    Observable.prototype.onError = function() {
      var f;
      f = makeFunctionArgs(arguments);
      return this.subscribe(function(event) {
        if (event.isError()) {
          return f(event.error);
        }
      });
    };
    Observable.prototype.onEnd = function() {
      var f;
      f = makeFunctionArgs(arguments);
      return this.subscribe(function(event) {
        if (event.isEnd()) {
          return f();
        }
      });
    };
    Observable.prototype.name = function(name) {
      this._name = name;
      return this;
    };
    Observable.prototype.withDescription = function() {
      return describe.apply(null, arguments).apply(this);
    };
    Observable.prototype.toString = function() {
      if (this._name) {
        return this._name;
      } else {
        return this.desc.toString();
      }
    };
    Observable.prototype.internalDeps = function() {
      return this.initialDesc.deps();
    };
    return Observable;
  })();
  Observable.prototype.assign = Observable.prototype.onValue;
  Observable.prototype.forEach = Observable.prototype.onValue;
  Observable.prototype.inspect = Observable.prototype.toString;
  Bacon.Observable = Observable;
  CompositeUnsubscribe = (function() {
    function CompositeUnsubscribe(ss) {
      var j,
          len1,
          s;
      if (ss == null) {
        ss = [];
      }
      this.unsubscribe = bind(this.unsubscribe, this);
      this.unsubscribed = false;
      this.subscriptions = [];
      this.starting = [];
      for (j = 0, len1 = ss.length; j < len1; j++) {
        s = ss[j];
        this.add(s);
      }
    }
    CompositeUnsubscribe.prototype.add = function(subscription) {
      var ended,
          unsub,
          unsubMe;
      if (this.unsubscribed) {
        return ;
      }
      ended = false;
      unsub = nop;
      this.starting.push(subscription);
      unsubMe = (function(_this) {
        return function() {
          if (_this.unsubscribed) {
            return ;
          }
          ended = true;
          _this.remove(unsub);
          return _.remove(subscription, _this.starting);
        };
      })(this);
      unsub = subscription(this.unsubscribe, unsubMe);
      if (!(this.unsubscribed || ended)) {
        this.subscriptions.push(unsub);
      } else {
        unsub();
      }
      _.remove(subscription, this.starting);
      return unsub;
    };
    CompositeUnsubscribe.prototype.remove = function(unsub) {
      if (this.unsubscribed) {
        return ;
      }
      if ((_.remove(unsub, this.subscriptions)) !== void 0) {
        return unsub();
      }
    };
    CompositeUnsubscribe.prototype.unsubscribe = function() {
      var j,
          len1,
          ref,
          s;
      if (this.unsubscribed) {
        return ;
      }
      this.unsubscribed = true;
      ref = this.subscriptions;
      for (j = 0, len1 = ref.length; j < len1; j++) {
        s = ref[j];
        s();
      }
      this.subscriptions = [];
      return this.starting = [];
    };
    CompositeUnsubscribe.prototype.count = function() {
      if (this.unsubscribed) {
        return 0;
      }
      return this.subscriptions.length + this.starting.length;
    };
    CompositeUnsubscribe.prototype.empty = function() {
      return this.count() === 0;
    };
    return CompositeUnsubscribe;
  })();
  Bacon.CompositeUnsubscribe = CompositeUnsubscribe;
  Dispatcher = (function() {
    function Dispatcher(_subscribe, _handleEvent) {
      this._subscribe = _subscribe;
      this._handleEvent = _handleEvent;
      this.subscribe = bind(this.subscribe, this);
      this.handleEvent = bind(this.handleEvent, this);
      this.subscriptions = [];
      this.queue = [];
      this.pushing = false;
      this.ended = false;
      this.prevError = void 0;
      this.unsubSrc = void 0;
    }
    Dispatcher.prototype.hasSubscribers = function() {
      return this.subscriptions.length > 0;
    };
    Dispatcher.prototype.removeSub = function(subscription) {
      return this.subscriptions = _.without(subscription, this.subscriptions);
    };
    Dispatcher.prototype.push = function(event) {
      if (event.isEnd()) {
        this.ended = true;
      }
      return UpdateBarrier.inTransaction(event, this, this.pushIt, [event]);
    };
    Dispatcher.prototype.pushToSubscriptions = function(event) {
      var e,
          j,
          len1,
          reply,
          sub,
          tmp;
      try {
        tmp = this.subscriptions;
        for (j = 0, len1 = tmp.length; j < len1; j++) {
          sub = tmp[j];
          reply = sub.sink(event);
          if (reply === Bacon.noMore || event.isEnd()) {
            this.removeSub(sub);
          }
        }
        return true;
      } catch (_error) {
        e = _error;
        this.pushing = false;
        this.queue = [];
        throw e;
      }
    };
    Dispatcher.prototype.pushIt = function(event) {
      if (!this.pushing) {
        if (event === this.prevError) {
          return ;
        }
        if (event.isError()) {
          this.prevError = event;
        }
        this.pushing = true;
        this.pushToSubscriptions(event);
        this.pushing = false;
        while (this.queue.length) {
          event = this.queue.shift();
          this.push(event);
        }
        if (this.hasSubscribers()) {
          return Bacon.more;
        } else {
          this.unsubscribeFromSource();
          return Bacon.noMore;
        }
      } else {
        this.queue.push(event);
        return Bacon.more;
      }
    };
    Dispatcher.prototype.handleEvent = function(event) {
      if (this._handleEvent) {
        return this._handleEvent(event);
      } else {
        return this.push(event);
      }
    };
    Dispatcher.prototype.unsubscribeFromSource = function() {
      if (this.unsubSrc) {
        this.unsubSrc();
      }
      return this.unsubSrc = void 0;
    };
    Dispatcher.prototype.subscribe = function(sink) {
      var subscription;
      if (this.ended) {
        sink(endEvent());
        return nop;
      } else {
        assertFunction(sink);
        subscription = {sink: sink};
        this.subscriptions.push(subscription);
        if (this.subscriptions.length === 1) {
          this.unsubSrc = this._subscribe(this.handleEvent);
          assertFunction(this.unsubSrc);
        }
        return (function(_this) {
          return function() {
            _this.removeSub(subscription);
            if (!_this.hasSubscribers()) {
              return _this.unsubscribeFromSource();
            }
          };
        })(this);
      }
    };
    return Dispatcher;
  })();
  EventStream = (function(superClass) {
    extend(EventStream, superClass);
    function EventStream(desc, subscribe, handler) {
      if (_.isFunction(desc)) {
        handler = subscribe;
        subscribe = desc;
        desc = [];
      }
      EventStream.__super__.constructor.call(this, desc);
      assertFunction(subscribe);
      this.dispatcher = new Dispatcher(subscribe, handler);
      registerObs(this);
    }
    EventStream.prototype.toProperty = function(initValue_) {
      var disp,
          initValue;
      initValue = arguments.length === 0 ? None : toOption(function() {
        return initValue_;
      });
      disp = this.dispatcher;
      return new Property(describe(this, "toProperty", initValue_), function(sink) {
        var initSent,
            reply,
            sendInit,
            unsub;
        initSent = false;
        unsub = nop;
        reply = Bacon.more;
        sendInit = function() {
          if (!initSent) {
            return initValue.forEach(function(value) {
              initSent = true;
              reply = sink(new Initial(value));
              if (reply === Bacon.noMore) {
                unsub();
                return unsub = nop;
              }
            });
          }
        };
        unsub = disp.subscribe(function(event) {
          if (event.hasValue()) {
            if (initSent && event.isInitial()) {
              return Bacon.more;
            } else {
              if (!event.isInitial()) {
                sendInit();
              }
              initSent = true;
              initValue = new Some(event);
              return sink(event);
            }
          } else {
            if (event.isEnd()) {
              reply = sendInit();
            }
            if (reply !== Bacon.noMore) {
              return sink(event);
            }
          }
        });
        sendInit();
        return unsub;
      });
    };
    EventStream.prototype.toEventStream = function() {
      return this;
    };
    EventStream.prototype.withHandler = function(handler) {
      return new EventStream(describe(this, "withHandler", handler), this.dispatcher.subscribe, handler);
    };
    return EventStream;
  })(Observable);
  Bacon.EventStream = EventStream;
  Bacon.never = function() {
    return new EventStream(describe(Bacon, "never"), function(sink) {
      sink(endEvent());
      return nop;
    });
  };
  Bacon.when = function() {
    var f,
        i,
        index,
        ix,
        j,
        k,
        len,
        len1,
        len2,
        needsBarrier,
        pat,
        patSources,
        pats,
        patterns,
        ref,
        resultStream,
        s,
        sources,
        triggerFound,
        usage;
    if (arguments.length === 0) {
      return Bacon.never();
    }
    len = arguments.length;
    usage = "when: expecting arguments in the form (Observable+,function)+";
    assert(usage, len % 2 === 0);
    sources = [];
    pats = [];
    i = 0;
    patterns = [];
    while (i < len) {
      patterns[i] = arguments[i];
      patterns[i + 1] = arguments[i + 1];
      patSources = _.toArray(arguments[i]);
      f = constantToFunction(arguments[i + 1]);
      pat = {
        f: f,
        ixs: []
      };
      triggerFound = false;
      for (j = 0, len1 = patSources.length; j < len1; j++) {
        s = patSources[j];
        index = _.indexOf(sources, s);
        if (!triggerFound) {
          triggerFound = Source.isTrigger(s);
        }
        if (index < 0) {
          sources.push(s);
          index = sources.length - 1;
        }
        ref = pat.ixs;
        for (k = 0, len2 = ref.length; k < len2; k++) {
          ix = ref[k];
          if (ix.index === index) {
            ix.count++;
          }
        }
        pat.ixs.push({
          index: index,
          count: 1
        });
      }
      assert("At least one EventStream required", triggerFound || (!patSources.length));
      if (patSources.length > 0) {
        pats.push(pat);
      }
      i = i + 2;
    }
    if (!sources.length) {
      return Bacon.never();
    }
    sources = _.map(Source.fromObservable, sources);
    needsBarrier = (_.any(sources, function(s) {
      return s.flatten;
    })) && (containsDuplicateDeps(_.map((function(s) {
      return s.obs;
    }), sources)));
    return resultStream = new EventStream(describe.apply(null, [Bacon, "when"].concat(slice.call(patterns))), function(sink) {
      var cannotMatch,
          cannotSync,
          ends,
          match,
          nonFlattened,
          part,
          triggers;
      triggers = [];
      ends = false;
      match = function(p) {
        var l,
            len3,
            ref1;
        ref1 = p.ixs;
        for (l = 0, len3 = ref1.length; l < len3; l++) {
          i = ref1[l];
          if (!sources[i.index].hasAtLeast(i.count)) {
            return false;
          }
        }
        return true;
      };
      cannotSync = function(source) {
        return !source.sync || source.ended;
      };
      cannotMatch = function(p) {
        var l,
            len3,
            ref1;
        ref1 = p.ixs;
        for (l = 0, len3 = ref1.length; l < len3; l++) {
          i = ref1[l];
          if (!sources[i.index].mayHave(i.count)) {
            return true;
          }
        }
      };
      nonFlattened = function(trigger) {
        return !trigger.source.flatten;
      };
      part = function(source) {
        return function(unsubAll) {
          var flush,
              flushLater,
              flushWhileTriggers;
          flushLater = function() {
            return UpdateBarrier.whenDoneWith(resultStream, flush);
          };
          flushWhileTriggers = function() {
            var events,
                l,
                len3,
                p,
                reply,
                trigger;
            if (triggers.length > 0) {
              reply = Bacon.more;
              trigger = triggers.pop();
              for (l = 0, len3 = pats.length; l < len3; l++) {
                p = pats[l];
                if (match(p)) {
                  events = (function() {
                    var len4,
                        m,
                        ref1,
                        results;
                    ref1 = p.ixs;
                    results = [];
                    for (m = 0, len4 = ref1.length; m < len4; m++) {
                      i = ref1[m];
                      results.push(sources[i.index].consume());
                    }
                    return results;
                  })();
                  reply = sink(trigger.e.apply(function() {
                    var event,
                        values;
                    values = (function() {
                      var len4,
                          m,
                          results;
                      results = [];
                      for (m = 0, len4 = events.length; m < len4; m++) {
                        event = events[m];
                        results.push(event.value());
                      }
                      return results;
                    })();
                    return p.f.apply(p, values);
                  }));
                  if (triggers.length) {
                    triggers = _.filter(nonFlattened, triggers);
                  }
                  if (reply === Bacon.noMore) {
                    return reply;
                  } else {
                    return flushWhileTriggers();
                  }
                }
              }
            } else {
              return Bacon.more;
            }
          };
          flush = function() {
            var reply;
            reply = flushWhileTriggers();
            if (ends) {
              ends = false;
              if (_.all(sources, cannotSync) || _.all(pats, cannotMatch)) {
                reply = Bacon.noMore;
                sink(endEvent());
              }
            }
            if (reply === Bacon.noMore) {
              unsubAll();
            }
            return reply;
          };
          return source.subscribe(function(e) {
            var reply;
            if (e.isEnd()) {
              ends = true;
              source.markEnded();
              flushLater();
            } else if (e.isError()) {
              reply = sink(e);
            } else {
              source.push(e);
              if (source.sync) {
                triggers.push({
                  source: source,
                  e: e
                });
                if (needsBarrier || UpdateBarrier.hasWaiters()) {
                  flushLater();
                } else {
                  flush();
                }
              }
            }
            if (reply === Bacon.noMore) {
              unsubAll();
            }
            return reply || Bacon.more;
          });
        };
      };
      return new Bacon.CompositeUnsubscribe((function() {
        var l,
            len3,
            results;
        results = [];
        for (l = 0, len3 = sources.length; l < len3; l++) {
          s = sources[l];
          results.push(part(s));
        }
        return results;
      })()).unsubscribe;
    });
  };
  containsDuplicateDeps = function(observables, state) {
    var checkObservable;
    if (state == null) {
      state = [];
    }
    checkObservable = function(obs) {
      var deps;
      if (_.contains(state, obs)) {
        return true;
      } else {
        deps = obs.internalDeps();
        if (deps.length) {
          state.push(obs);
          return _.any(deps, checkObservable);
        } else {
          state.push(obs);
          return false;
        }
      }
    };
    return _.any(observables, checkObservable);
  };
  constantToFunction = function(f) {
    if (_.isFunction(f)) {
      return f;
    } else {
      return _.always(f);
    }
  };
  Bacon.groupSimultaneous = function() {
    var s,
        sources,
        streams;
    streams = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    if (streams.length === 1 && isArray(streams[0])) {
      streams = streams[0];
    }
    sources = (function() {
      var j,
          len1,
          results;
      results = [];
      for (j = 0, len1 = streams.length; j < len1; j++) {
        s = streams[j];
        results.push(new BufferingSource(s));
      }
      return results;
    })();
    return withDescription.apply(null, [Bacon, "groupSimultaneous"].concat(slice.call(streams), [Bacon.when(sources, (function() {
      var xs;
      xs = 1 <= arguments.length ? slice.call(arguments, 0) : [];
      return xs;
    }))]));
  };
  PropertyDispatcher = (function(superClass) {
    extend(PropertyDispatcher, superClass);
    function PropertyDispatcher(property1, subscribe, handleEvent) {
      this.property = property1;
      this.subscribe = bind(this.subscribe, this);
      PropertyDispatcher.__super__.constructor.call(this, subscribe, handleEvent);
      this.current = None;
      this.currentValueRootId = void 0;
      this.propertyEnded = false;
    }
    PropertyDispatcher.prototype.push = function(event) {
      if (event.isEnd()) {
        this.propertyEnded = true;
      }
      if (event.hasValue()) {
        this.current = new Some(event);
        this.currentValueRootId = UpdateBarrier.currentEventId();
      }
      return PropertyDispatcher.__super__.push.call(this, event);
    };
    PropertyDispatcher.prototype.maybeSubSource = function(sink, reply) {
      if (reply === Bacon.noMore) {
        return nop;
      } else if (this.propertyEnded) {
        sink(endEvent());
        return nop;
      } else {
        return Dispatcher.prototype.subscribe.call(this, sink);
      }
    };
    PropertyDispatcher.prototype.subscribe = function(sink) {
      var dispatchingId,
          initSent,
          reply,
          valId;
      initSent = false;
      reply = Bacon.more;
      if (this.current.isDefined && (this.hasSubscribers() || this.propertyEnded)) {
        dispatchingId = UpdateBarrier.currentEventId();
        valId = this.currentValueRootId;
        if (!this.propertyEnded && valId && dispatchingId && dispatchingId !== valId) {
          UpdateBarrier.whenDoneWith(this.property, (function(_this) {
            return function() {
              if (_this.currentValueRootId === valId) {
                return sink(initialEvent(_this.current.get().value()));
              }
            };
          })(this));
          return this.maybeSubSource(sink, reply);
        } else {
          UpdateBarrier.inTransaction(void 0, this, (function() {
            return reply = sink(initialEvent(this.current.get().value()));
          }), []);
          return this.maybeSubSource(sink, reply);
        }
      } else {
        return this.maybeSubSource(sink, reply);
      }
    };
    return PropertyDispatcher;
  })(Dispatcher);
  Property = (function(superClass) {
    extend(Property, superClass);
    function Property(desc, subscribe, handler) {
      if (_.isFunction(desc)) {
        handler = subscribe;
        subscribe = desc;
        desc = [];
      }
      Property.__super__.constructor.call(this, desc);
      assertFunction(subscribe);
      this.dispatcher = new PropertyDispatcher(this, subscribe, handler);
      registerObs(this);
    }
    Property.prototype.changes = function() {
      return new EventStream(describe(this, "changes"), (function(_this) {
        return function(sink) {
          return _this.dispatcher.subscribe(function(event) {
            if (!event.isInitial()) {
              return sink(event);
            }
          });
        };
      })(this));
    };
    Property.prototype.withHandler = function(handler) {
      return new Property(describe(this, "withHandler", handler), this.dispatcher.subscribe, handler);
    };
    Property.prototype.toProperty = function() {
      assertNoArguments(arguments);
      return this;
    };
    Property.prototype.toEventStream = function() {
      return new EventStream(describe(this, "toEventStream"), (function(_this) {
        return function(sink) {
          return _this.dispatcher.subscribe(function(event) {
            if (event.isInitial()) {
              event = event.toNext();
            }
            return sink(event);
          });
        };
      })(this));
    };
    return Property;
  })(Observable);
  Bacon.Property = Property;
  Bacon.constant = function(value) {
    return new Property(describe(Bacon, "constant", value), function(sink) {
      sink(initialEvent(value));
      sink(endEvent());
      return nop;
    });
  };
  Bacon.fromBinder = function(binder, eventTransformer) {
    if (eventTransformer == null) {
      eventTransformer = _.id;
    }
    return new EventStream(describe(Bacon, "fromBinder", binder, eventTransformer), function(sink) {
      var shouldUnbind,
          unbind,
          unbinder,
          unbound;
      unbound = false;
      shouldUnbind = false;
      unbind = function() {
        if (!unbound) {
          if (typeof unbinder !== "undefined" && unbinder !== null) {
            unbinder();
            return unbound = true;
          } else {
            return shouldUnbind = true;
          }
        }
      };
      unbinder = binder(function() {
        var args,
            event,
            j,
            len1,
            reply,
            value;
        args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
        value = eventTransformer.apply(this, args);
        if (!(isArray(value) && _.last(value) instanceof Event)) {
          value = [value];
        }
        reply = Bacon.more;
        for (j = 0, len1 = value.length; j < len1; j++) {
          event = value[j];
          reply = sink(event = toEvent(event));
          if (reply === Bacon.noMore || event.isEnd()) {
            unbind();
            return reply;
          }
        }
        return reply;
      });
      if (shouldUnbind) {
        unbind();
      }
      return unbind;
    });
  };
  eventMethods = [["addEventListener", "removeEventListener"], ["addListener", "removeListener"], ["on", "off"], ["bind", "unbind"]];
  findHandlerMethods = function(target) {
    var j,
        len1,
        methodPair,
        pair;
    for (j = 0, len1 = eventMethods.length; j < len1; j++) {
      pair = eventMethods[j];
      methodPair = [target[pair[0]], target[pair[1]]];
      if (methodPair[0] && methodPair[1]) {
        return methodPair;
      }
    }
    throw new Error("No suitable event methods in " + target);
  };
  Bacon.fromEventTarget = function(target, eventName, eventTransformer) {
    var ref,
        sub,
        unsub;
    ref = findHandlerMethods(target), sub = ref[0], unsub = ref[1];
    return withDescription(Bacon, "fromEvent", target, eventName, Bacon.fromBinder(function(handler) {
      sub.call(target, eventName, handler);
      return function() {
        return unsub.call(target, eventName, handler);
      };
    }, eventTransformer));
  };
  Bacon.fromEvent = Bacon.fromEventTarget;
  Bacon.Observable.prototype.map = function() {
    var args,
        p;
    p = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    return convertArgsToFunction(this, p, args, function(f) {
      return withDescription(this, "map", f, this.withHandler(function(event) {
        return this.push(event.fmap(f));
      }));
    });
  };
  Bacon.combineAsArray = function() {
    var index,
        j,
        len1,
        s,
        sources,
        stream,
        streams;
    streams = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    if (streams.length === 1 && isArray(streams[0])) {
      streams = streams[0];
    }
    for (index = j = 0, len1 = streams.length; j < len1; index = ++j) {
      stream = streams[index];
      if (!(isObservable(stream))) {
        streams[index] = Bacon.constant(stream);
      }
    }
    if (streams.length) {
      sources = (function() {
        var k,
            len2,
            results;
        results = [];
        for (k = 0, len2 = streams.length; k < len2; k++) {
          s = streams[k];
          results.push(new Source(s, true));
        }
        return results;
      })();
      return withDescription.apply(null, [Bacon, "combineAsArray"].concat(slice.call(streams), [Bacon.when(sources, (function() {
        var xs;
        xs = 1 <= arguments.length ? slice.call(arguments, 0) : [];
        return xs;
      })).toProperty()]));
    } else {
      return Bacon.constant([]);
    }
  };
  Bacon.onValues = function() {
    var f,
        j,
        streams;
    streams = 2 <= arguments.length ? slice.call(arguments, 0, j = arguments.length - 1) : (j = 0, []), f = arguments[j++];
    return Bacon.combineAsArray(streams).onValues(f);
  };
  Bacon.combineWith = function() {
    var f,
        streams;
    f = arguments[0], streams = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    return withDescription.apply(null, [Bacon, "combineWith", f].concat(slice.call(streams), [Bacon.combineAsArray(streams).map(function(values) {
      return f.apply(null, values);
    })]));
  };
  Bacon.combineTemplate = function(template) {
    var applyStreamValue,
        combinator,
        compile,
        compileTemplate,
        constantValue,
        current,
        funcs,
        mkContext,
        setValue,
        streams;
    funcs = [];
    streams = [];
    current = function(ctxStack) {
      return ctxStack[ctxStack.length - 1];
    };
    setValue = function(ctxStack, key, value) {
      return current(ctxStack)[key] = value;
    };
    applyStreamValue = function(key, index) {
      return function(ctxStack, values) {
        return setValue(ctxStack, key, values[index]);
      };
    };
    constantValue = function(key, value) {
      return function(ctxStack) {
        return setValue(ctxStack, key, value);
      };
    };
    mkContext = function(template) {
      if (isArray(template)) {
        return [];
      } else {
        return {};
      }
    };
    compile = function(key, value) {
      var popContext,
          pushContext;
      if (isObservable(value)) {
        streams.push(value);
        return funcs.push(applyStreamValue(key, streams.length - 1));
      } else if (value === Object(value) && typeof value !== "function" && !(value instanceof RegExp) && !(value instanceof Date)) {
        pushContext = function(key) {
          return function(ctxStack) {
            var newContext;
            newContext = mkContext(value);
            setValue(ctxStack, key, newContext);
            return ctxStack.push(newContext);
          };
        };
        popContext = function(ctxStack) {
          return ctxStack.pop();
        };
        funcs.push(pushContext(key));
        compileTemplate(value);
        return funcs.push(popContext);
      } else {
        return funcs.push(constantValue(key, value));
      }
    };
    compileTemplate = function(template) {
      return _.each(template, compile);
    };
    compileTemplate(template);
    combinator = function(values) {
      var ctxStack,
          f,
          j,
          len1,
          rootContext;
      rootContext = mkContext(template);
      ctxStack = [rootContext];
      for (j = 0, len1 = funcs.length; j < len1; j++) {
        f = funcs[j];
        f(ctxStack, values);
      }
      return rootContext;
    };
    return withDescription(Bacon, "combineTemplate", template, Bacon.combineAsArray(streams).map(combinator));
  };
  Bacon.Observable.prototype.combine = function(other, f) {
    var combinator;
    combinator = toCombinator(f);
    return withDescription(this, "combine", other, f, Bacon.combineAsArray(this, other).map(function(values) {
      return combinator(values[0], values[1]);
    }));
  };
  Bacon.Observable.prototype.decode = function(cases) {
    return withDescription(this, "decode", cases, this.combine(Bacon.combineTemplate(cases), function(key, values) {
      return values[key];
    }));
  };
  Bacon.Observable.prototype.withStateMachine = function(initState, f) {
    var state;
    state = initState;
    return withDescription(this, "withStateMachine", initState, f, this.withHandler(function(event) {
      var fromF,
          j,
          len1,
          newState,
          output,
          outputs,
          reply;
      fromF = f(state, event);
      newState = fromF[0], outputs = fromF[1];
      state = newState;
      reply = Bacon.more;
      for (j = 0, len1 = outputs.length; j < len1; j++) {
        output = outputs[j];
        reply = this.push(output);
        if (reply === Bacon.noMore) {
          return reply;
        }
      }
      return reply;
    }));
  };
  Bacon.Observable.prototype.skipDuplicates = function(isEqual) {
    if (isEqual == null) {
      isEqual = function(a, b) {
        return a === b;
      };
    }
    return withDescription(this, "skipDuplicates", this.withStateMachine(None, function(prev, event) {
      if (!event.hasValue()) {
        return [prev, [event]];
      } else if (event.isInitial() || prev === None || !isEqual(prev.get(), event.value())) {
        return [new Some(event.value()), [event]];
      } else {
        return [prev, []];
      }
    }));
  };
  Bacon.Observable.prototype.awaiting = function(other) {
    return withDescription(this, "awaiting", other, Bacon.groupSimultaneous(this, other).map(function(arg) {
      var myValues,
          otherValues;
      myValues = arg[0], otherValues = arg[1];
      return otherValues.length === 0;
    }).toProperty(false).skipDuplicates());
  };
  Bacon.Observable.prototype.not = function() {
    return withDescription(this, "not", this.map(function(x) {
      return !x;
    }));
  };
  Bacon.Property.prototype.and = function(other) {
    return withDescription(this, "and", other, this.combine(other, function(x, y) {
      return x && y;
    }));
  };
  Bacon.Property.prototype.or = function(other) {
    return withDescription(this, "or", other, this.combine(other, function(x, y) {
      return x || y;
    }));
  };
  Bacon.scheduler = {
    setTimeout: function(f, d) {
      return setTimeout(f, d);
    },
    setInterval: function(f, i) {
      return setInterval(f, i);
    },
    clearInterval: function(id) {
      return clearInterval(id);
    },
    clearTimeout: function(id) {
      return clearTimeout(id);
    },
    now: function() {
      return new Date().getTime();
    }
  };
  Bacon.EventStream.prototype.bufferWithTime = function(delay) {
    return withDescription(this, "bufferWithTime", delay, this.bufferWithTimeOrCount(delay, Number.MAX_VALUE));
  };
  Bacon.EventStream.prototype.bufferWithCount = function(count) {
    return withDescription(this, "bufferWithCount", count, this.bufferWithTimeOrCount(void 0, count));
  };
  Bacon.EventStream.prototype.bufferWithTimeOrCount = function(delay, count) {
    var flushOrSchedule;
    flushOrSchedule = function(buffer) {
      if (buffer.values.length === count) {
        return buffer.flush();
      } else if (delay !== void 0) {
        return buffer.schedule();
      }
    };
    return withDescription(this, "bufferWithTimeOrCount", delay, count, this.buffer(delay, flushOrSchedule, flushOrSchedule));
  };
  Bacon.EventStream.prototype.buffer = function(delay, onInput, onFlush) {
    var buffer,
        delayMs,
        reply;
    if (onInput == null) {
      onInput = nop;
    }
    if (onFlush == null) {
      onFlush = nop;
    }
    buffer = {
      scheduled: null,
      end: void 0,
      values: [],
      flush: function() {
        var reply;
        if (this.scheduled) {
          Bacon.scheduler.clearTimeout(this.scheduled);
          this.scheduled = null;
        }
        if (this.values.length > 0) {
          reply = this.push(nextEvent(this.values));
          this.values = [];
          if (this.end != null) {
            return this.push(this.end);
          } else if (reply !== Bacon.noMore) {
            return onFlush(this);
          }
        } else {
          if (this.end != null) {
            return this.push(this.end);
          }
        }
      },
      schedule: function() {
        if (!this.scheduled) {
          return this.scheduled = delay((function(_this) {
            return function() {
              return _this.flush();
            };
          })(this));
        }
      }
    };
    reply = Bacon.more;
    if (!_.isFunction(delay)) {
      delayMs = delay;
      delay = function(f) {
        return Bacon.scheduler.setTimeout(f, delayMs);
      };
    }
    return withDescription(this, "buffer", this.withHandler(function(event) {
      buffer.push = (function(_this) {
        return function(event) {
          return _this.push(event);
        };
      })(this);
      if (event.isError()) {
        reply = this.push(event);
      } else if (event.isEnd()) {
        buffer.end = event;
        if (!buffer.scheduled) {
          buffer.flush();
        }
      } else {
        buffer.values.push(event.value());
        onInput(buffer);
      }
      return reply;
    }));
  };
  Bacon.Observable.prototype.filter = function() {
    var args,
        f;
    f = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    assertObservableIsProperty(f);
    return convertArgsToFunction(this, f, args, function(f) {
      return withDescription(this, "filter", f, this.withHandler(function(event) {
        if (event.filter(f)) {
          return this.push(event);
        } else {
          return Bacon.more;
        }
      }));
    });
  };
  Bacon.once = function(value) {
    return new EventStream(describe(Bacon, "once", value), function(sink) {
      sink(toEvent(value));
      sink(endEvent());
      return nop;
    });
  };
  Bacon.EventStream.prototype.concat = function(right) {
    var left;
    left = this;
    return new EventStream(describe(left, "concat", right), function(sink) {
      var unsubLeft,
          unsubRight;
      unsubRight = nop;
      unsubLeft = left.dispatcher.subscribe(function(e) {
        if (e.isEnd()) {
          return unsubRight = right.dispatcher.subscribe(sink);
        } else {
          return sink(e);
        }
      });
      return function() {
        unsubLeft();
        return unsubRight();
      };
    });
  };
  Bacon.Observable.prototype.flatMap = function() {
    return flatMap_(this, makeSpawner(arguments));
  };
  Bacon.Observable.prototype.flatMapFirst = function() {
    return flatMap_(this, makeSpawner(arguments), true);
  };
  flatMap_ = function(root, f, firstOnly, limit) {
    var childDeps,
        result,
        rootDep;
    rootDep = [root];
    childDeps = [];
    result = new EventStream(describe(root, "flatMap" + (firstOnly ? "First" : ""), f), function(sink) {
      var checkEnd,
          checkQueue,
          composite,
          queue,
          spawn;
      composite = new CompositeUnsubscribe();
      queue = [];
      spawn = function(event) {
        var child;
        child = makeObservable(f(event.value()));
        childDeps.push(child);
        return composite.add(function(unsubAll, unsubMe) {
          return child.dispatcher.subscribe(function(event) {
            var reply;
            if (event.isEnd()) {
              _.remove(child, childDeps);
              checkQueue();
              checkEnd(unsubMe);
              return Bacon.noMore;
            } else {
              if (event instanceof Initial) {
                event = event.toNext();
              }
              reply = sink(event);
              if (reply === Bacon.noMore) {
                unsubAll();
              }
              return reply;
            }
          });
        });
      };
      checkQueue = function() {
        var event;
        event = queue.shift();
        if (event) {
          return spawn(event);
        }
      };
      checkEnd = function(unsub) {
        unsub();
        if (composite.empty()) {
          return sink(endEvent());
        }
      };
      composite.add(function(__, unsubRoot) {
        return root.dispatcher.subscribe(function(event) {
          if (event.isEnd()) {
            return checkEnd(unsubRoot);
          } else if (event.isError()) {
            return sink(event);
          } else if (firstOnly && composite.count() > 1) {
            return Bacon.more;
          } else {
            if (composite.unsubscribed) {
              return Bacon.noMore;
            }
            if (limit && composite.count() > limit) {
              return queue.push(event);
            } else {
              return spawn(event);
            }
          }
        });
      });
      return composite.unsubscribe;
    });
    result.internalDeps = function() {
      if (childDeps.length) {
        return rootDep.concat(childDeps);
      } else {
        return rootDep;
      }
    };
    return result;
  };
  makeSpawner = function(args) {
    if (args.length === 1 && isObservable(args[0])) {
      return _.always(args[0]);
    } else {
      return makeFunctionArgs(args);
    }
  };
  makeObservable = function(x) {
    if (isObservable(x)) {
      return x;
    } else {
      return Bacon.once(x);
    }
  };
  Bacon.Observable.prototype.flatMapWithConcurrencyLimit = function() {
    var args,
        limit;
    limit = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    return withDescription.apply(null, [this, "flatMapWithConcurrencyLimit", limit].concat(slice.call(args), [flatMap_(this, makeSpawner(args), false, limit)]));
  };
  Bacon.Observable.prototype.flatMapConcat = function() {
    return withDescription.apply(null, [this, "flatMapConcat"].concat(slice.call(arguments), [this.flatMapWithConcurrencyLimit.apply(this, [1].concat(slice.call(arguments)))]));
  };
  Bacon.later = function(delay, value) {
    return withDescription(Bacon, "later", delay, value, Bacon.fromBinder(function(sink) {
      var id,
          sender;
      sender = function() {
        return sink([value, endEvent()]);
      };
      id = Bacon.scheduler.setTimeout(sender, delay);
      return function() {
        return Bacon.scheduler.clearTimeout(id);
      };
    }));
  };
  Bacon.Observable.prototype.bufferingThrottle = function(minimumInterval) {
    return withDescription(this, "bufferingThrottle", minimumInterval, this.flatMapConcat(function(x) {
      return Bacon.once(x).concat(Bacon.later(minimumInterval).filter(false));
    }));
  };
  Bacon.Property.prototype.bufferingThrottle = function() {
    return Bacon.Observable.prototype.bufferingThrottle.apply(this, arguments).toProperty();
  };
  Bus = (function(superClass) {
    extend(Bus, superClass);
    function Bus() {
      this.guardedSink = bind(this.guardedSink, this);
      this.subscribeAll = bind(this.subscribeAll, this);
      this.unsubAll = bind(this.unsubAll, this);
      this.sink = void 0;
      this.subscriptions = [];
      this.ended = false;
      Bus.__super__.constructor.call(this, describe(Bacon, "Bus"), this.subscribeAll);
    }
    Bus.prototype.unsubAll = function() {
      var j,
          len1,
          ref,
          sub;
      ref = this.subscriptions;
      for (j = 0, len1 = ref.length; j < len1; j++) {
        sub = ref[j];
        if (typeof sub.unsub === "function") {
          sub.unsub();
        }
      }
      return void 0;
    };
    Bus.prototype.subscribeAll = function(newSink) {
      var j,
          len1,
          ref,
          subscription;
      if (this.ended) {
        newSink(endEvent());
      } else {
        this.sink = newSink;
        ref = cloneArray(this.subscriptions);
        for (j = 0, len1 = ref.length; j < len1; j++) {
          subscription = ref[j];
          this.subscribeInput(subscription);
        }
      }
      return this.unsubAll;
    };
    Bus.prototype.guardedSink = function(input) {
      return (function(_this) {
        return function(event) {
          if (event.isEnd()) {
            _this.unsubscribeInput(input);
            return Bacon.noMore;
          } else {
            return _this.sink(event);
          }
        };
      })(this);
    };
    Bus.prototype.subscribeInput = function(subscription) {
      return subscription.unsub = subscription.input.dispatcher.subscribe(this.guardedSink(subscription.input));
    };
    Bus.prototype.unsubscribeInput = function(input) {
      var i,
          j,
          len1,
          ref,
          sub;
      ref = this.subscriptions;
      for (i = j = 0, len1 = ref.length; j < len1; i = ++j) {
        sub = ref[i];
        if (sub.input === input) {
          if (typeof sub.unsub === "function") {
            sub.unsub();
          }
          this.subscriptions.splice(i, 1);
          return ;
        }
      }
    };
    Bus.prototype.plug = function(input) {
      var sub;
      assertObservable(input);
      if (this.ended) {
        return ;
      }
      sub = {input: input};
      this.subscriptions.push(sub);
      if ((this.sink != null)) {
        this.subscribeInput(sub);
      }
      return (function(_this) {
        return function() {
          return _this.unsubscribeInput(input);
        };
      })(this);
    };
    Bus.prototype.end = function() {
      this.ended = true;
      this.unsubAll();
      return typeof this.sink === "function" ? this.sink(endEvent()) : void 0;
    };
    Bus.prototype.push = function(value) {
      if (!this.ended) {
        return typeof this.sink === "function" ? this.sink(nextEvent(value)) : void 0;
      }
    };
    Bus.prototype.error = function(error) {
      return typeof this.sink === "function" ? this.sink(new Error(error)) : void 0;
    };
    return Bus;
  })(EventStream);
  Bacon.Bus = Bus;
  liftCallback = function(desc, wrapped) {
    return withMethodCallSupport(function() {
      var args,
          f,
          stream;
      f = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
      stream = partiallyApplied(wrapped, [function(values, callback) {
        return f.apply(null, slice.call(values).concat([callback]));
      }]);
      return withDescription.apply(null, [Bacon, desc, f].concat(slice.call(args), [Bacon.combineAsArray(args).flatMap(stream)]));
    });
  };
  Bacon.fromCallback = liftCallback("fromCallback", function() {
    var args,
        f;
    f = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    return Bacon.fromBinder(function(handler) {
      makeFunction(f, args)(handler);
      return nop;
    }, (function(value) {
      return [value, endEvent()];
    }));
  });
  Bacon.fromNodeCallback = liftCallback("fromNodeCallback", function() {
    var args,
        f;
    f = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    return Bacon.fromBinder(function(handler) {
      makeFunction(f, args)(handler);
      return nop;
    }, function(error, value) {
      if (error) {
        return [new Error(error), endEvent()];
      }
      return [value, endEvent()];
    });
  });
  addPropertyInitValueToStream = function(property, stream) {
    var justInitValue;
    justInitValue = new EventStream(describe(property, "justInitValue"), function(sink) {
      var unsub,
          value;
      value = void 0;
      unsub = property.dispatcher.subscribe(function(event) {
        if (!event.isEnd()) {
          value = event;
        }
        return Bacon.noMore;
      });
      UpdateBarrier.whenDoneWith(justInitValue, function() {
        if (value != null) {
          sink(value);
        }
        return sink(endEvent());
      });
      return unsub;
    });
    return justInitValue.concat(stream).toProperty();
  };
  Bacon.Observable.prototype.mapEnd = function() {
    var f;
    f = makeFunctionArgs(arguments);
    return withDescription(this, "mapEnd", f, this.withHandler(function(event) {
      if (event.isEnd()) {
        this.push(nextEvent(f(event)));
        this.push(endEvent());
        return Bacon.noMore;
      } else {
        return this.push(event);
      }
    }));
  };
  Bacon.Observable.prototype.skipErrors = function() {
    return withDescription(this, "skipErrors", this.withHandler(function(event) {
      if (event.isError()) {
        return Bacon.more;
      } else {
        return this.push(event);
      }
    }));
  };
  Bacon.EventStream.prototype.takeUntil = function(stopper) {
    var endMarker;
    endMarker = {};
    return withDescription(this, "takeUntil", stopper, Bacon.groupSimultaneous(this.mapEnd(endMarker), stopper.skipErrors()).withHandler(function(event) {
      var data,
          j,
          len1,
          ref,
          reply,
          value;
      if (!event.hasValue()) {
        return this.push(event);
      } else {
        ref = event.value(), data = ref[0], stopper = ref[1];
        if (stopper.length) {
          return this.push(endEvent());
        } else {
          reply = Bacon.more;
          for (j = 0, len1 = data.length; j < len1; j++) {
            value = data[j];
            if (value === endMarker) {
              reply = this.push(endEvent());
            } else {
              reply = this.push(nextEvent(value));
            }
          }
          return reply;
        }
      }
    }));
  };
  Bacon.Property.prototype.takeUntil = function(stopper) {
    var changes;
    changes = this.changes().takeUntil(stopper);
    return withDescription(this, "takeUntil", stopper, addPropertyInitValueToStream(this, changes));
  };
  Bacon.Observable.prototype.flatMapLatest = function() {
    var f,
        stream;
    f = makeSpawner(arguments);
    stream = this.toEventStream();
    return withDescription(this, "flatMapLatest", f, stream.flatMap(function(value) {
      return makeObservable(f(value)).takeUntil(stream);
    }));
  };
  Bacon.Property.prototype.delayChanges = function() {
    var desc,
        f,
        j;
    desc = 2 <= arguments.length ? slice.call(arguments, 0, j = arguments.length - 1) : (j = 0, []), f = arguments[j++];
    return withDescription.apply(null, [this].concat(slice.call(desc), [addPropertyInitValueToStream(this, f(this.changes()))]));
  };
  Bacon.EventStream.prototype.delay = function(delay) {
    return withDescription(this, "delay", delay, this.flatMap(function(value) {
      return Bacon.later(delay, value);
    }));
  };
  Bacon.Property.prototype.delay = function(delay) {
    return this.delayChanges("delay", delay, function(changes) {
      return changes.delay(delay);
    });
  };
  Bacon.EventStream.prototype.debounce = function(delay) {
    return withDescription(this, "debounce", delay, this.flatMapLatest(function(value) {
      return Bacon.later(delay, value);
    }));
  };
  Bacon.Property.prototype.debounce = function(delay) {
    return this.delayChanges("debounce", delay, function(changes) {
      return changes.debounce(delay);
    });
  };
  Bacon.EventStream.prototype.debounceImmediate = function(delay) {
    return withDescription(this, "debounceImmediate", delay, this.flatMapFirst(function(value) {
      return Bacon.once(value).concat(Bacon.later(delay).filter(false));
    }));
  };
  Bacon.Observable.prototype.scan = function(seed, f) {
    var acc,
        resultProperty,
        subscribe;
    f = toCombinator(f);
    acc = toOption(seed);
    subscribe = (function(_this) {
      return function(sink) {
        var initSent,
            reply,
            sendInit,
            unsub;
        initSent = false;
        unsub = nop;
        reply = Bacon.more;
        sendInit = function() {
          if (!initSent) {
            return acc.forEach(function(value) {
              initSent = true;
              reply = sink(new Initial(function() {
                return value;
              }));
              if (reply === Bacon.noMore) {
                unsub();
                return unsub = nop;
              }
            });
          }
        };
        unsub = _this.dispatcher.subscribe(function(event) {
          var next,
              prev;
          if (event.hasValue()) {
            if (initSent && event.isInitial()) {
              return Bacon.more;
            } else {
              if (!event.isInitial()) {
                sendInit();
              }
              initSent = true;
              prev = acc.getOrElse(void 0);
              next = f(prev, event.value());
              acc = new Some(next);
              return sink(event.apply(function() {
                return next;
              }));
            }
          } else {
            if (event.isEnd()) {
              reply = sendInit();
            }
            if (reply !== Bacon.noMore) {
              return sink(event);
            }
          }
        });
        UpdateBarrier.whenDoneWith(resultProperty, sendInit);
        return unsub;
      };
    })(this);
    return resultProperty = new Property(describe(this, "scan", seed, f), subscribe);
  };
  Bacon.Observable.prototype.diff = function(start, f) {
    f = toCombinator(f);
    return withDescription(this, "diff", start, f, this.scan([start], function(prevTuple, next) {
      return [next, f(prevTuple[0], next)];
    }).filter(function(tuple) {
      return tuple.length === 2;
    }).map(function(tuple) {
      return tuple[1];
    }));
  };
  Bacon.Observable.prototype.doAction = function() {
    var f;
    f = makeFunctionArgs(arguments);
    return withDescription(this, "doAction", f, this.withHandler(function(event) {
      if (event.hasValue()) {
        f(event.value());
      }
      return this.push(event);
    }));
  };
  Bacon.Observable.prototype.endOnError = function() {
    var args,
        f;
    f = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    if (f == null) {
      f = true;
    }
    return convertArgsToFunction(this, f, args, function(f) {
      return withDescription(this, "endOnError", this.withHandler(function(event) {
        if (event.isError() && f(event.error)) {
          this.push(event);
          return this.push(endEvent());
        } else {
          return this.push(event);
        }
      }));
    });
  };
  Observable.prototype.errors = function() {
    return withDescription(this, "errors", this.filter(function() {
      return false;
    }));
  };
  valueAndEnd = (function(value) {
    return [value, endEvent()];
  });
  Bacon.fromPromise = function(promise, abort) {
    return withDescription(Bacon, "fromPromise", promise, Bacon.fromBinder(function(handler) {
      var ref;
      if ((ref = promise.then(handler, function(e) {
        return handler(new Error(e));
      })) != null) {
        if (typeof ref.done === "function") {
          ref.done();
        }
      }
      return function() {
        if (abort) {
          return typeof promise.abort === "function" ? promise.abort() : void 0;
        }
      };
    }, valueAndEnd));
  };
  Bacon.Observable.prototype.mapError = function() {
    var f;
    f = makeFunctionArgs(arguments);
    return withDescription(this, "mapError", f, this.withHandler(function(event) {
      if (event.isError()) {
        return this.push(nextEvent(f(event.error)));
      } else {
        return this.push(event);
      }
    }));
  };
  Bacon.Observable.prototype.flatMapError = function(fn) {
    return withDescription(this, "flatMapError", fn, this.mapError(function(err) {
      return new Error(err);
    }).flatMap(function(x) {
      if (x instanceof Error) {
        return fn(x.error);
      } else {
        return Bacon.once(x);
      }
    }));
  };
  Bacon.EventStream.prototype.sampledBy = function(sampler, combinator) {
    return withDescription(this, "sampledBy", sampler, combinator, this.toProperty().sampledBy(sampler, combinator));
  };
  Bacon.Property.prototype.sampledBy = function(sampler, combinator) {
    var lazy,
        result,
        samplerSource,
        stream,
        thisSource;
    if (combinator != null) {
      combinator = toCombinator(combinator);
    } else {
      lazy = true;
      combinator = function(f) {
        return f.value();
      };
    }
    thisSource = new Source(this, false, lazy);
    samplerSource = new Source(sampler, true, lazy);
    stream = Bacon.when([thisSource, samplerSource], combinator);
    result = sampler instanceof Property ? stream.toProperty() : stream;
    return withDescription(this, "sampledBy", sampler, combinator, result);
  };
  Bacon.Property.prototype.sample = function(interval) {
    return withDescription(this, "sample", interval, this.sampledBy(Bacon.interval(interval, {})));
  };
  Bacon.Observable.prototype.map = function() {
    var args,
        p;
    p = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    if (p instanceof Property) {
      return p.sampledBy(this, former);
    } else {
      return convertArgsToFunction(this, p, args, function(f) {
        return withDescription(this, "map", f, this.withHandler(function(event) {
          return this.push(event.fmap(f));
        }));
      });
    }
  };
  Bacon.Observable.prototype.fold = function(seed, f) {
    return withDescription(this, "fold", seed, f, this.scan(seed, f).sampledBy(this.filter(false).mapEnd().toProperty()));
  };
  Observable.prototype.reduce = Observable.prototype.fold;
  Bacon.fromPoll = function(delay, poll) {
    return withDescription(Bacon, "fromPoll", delay, poll, Bacon.fromBinder((function(handler) {
      var id;
      id = Bacon.scheduler.setInterval(handler, delay);
      return function() {
        return Bacon.scheduler.clearInterval(id);
      };
    }), poll));
  };
  Bacon.EventStream.prototype.merge = function(right) {
    var left;
    assertEventStream(right);
    left = this;
    return withDescription(left, "merge", right, Bacon.mergeAll(this, right));
  };
  Bacon.mergeAll = function() {
    var streams;
    streams = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    if (isArray(streams[0])) {
      streams = streams[0];
    }
    if (streams.length) {
      return new EventStream(describe.apply(null, [Bacon, "mergeAll"].concat(slice.call(streams))), function(sink) {
        var ends,
            sinks,
            smartSink;
        ends = 0;
        smartSink = function(obs) {
          return function(unsubBoth) {
            return obs.dispatcher.subscribe(function(event) {
              var reply;
              if (event.isEnd()) {
                ends++;
                if (ends === streams.length) {
                  return sink(endEvent());
                } else {
                  return Bacon.more;
                }
              } else {
                reply = sink(event);
                if (reply === Bacon.noMore) {
                  unsubBoth();
                }
                return reply;
              }
            });
          };
        };
        sinks = _.map(smartSink, streams);
        return new Bacon.CompositeUnsubscribe(sinks).unsubscribe;
      });
    } else {
      return Bacon.never();
    }
  };
  Bacon.Observable.prototype.take = function(count) {
    if (count <= 0) {
      return Bacon.never();
    }
    return withDescription(this, "take", count, this.withHandler(function(event) {
      if (!event.hasValue()) {
        return this.push(event);
      } else {
        count--;
        if (count > 0) {
          return this.push(event);
        } else {
          if (count === 0) {
            this.push(event);
          }
          this.push(endEvent());
          return Bacon.noMore;
        }
      }
    }));
  };
  Bacon.fromArray = function(values) {
    var i;
    assertArray(values);
    if (!values.length) {
      return withDescription(Bacon, "fromArray", values, Bacon.never());
    } else {
      i = 0;
      return new EventStream(describe(Bacon, "fromArray", values), function(sink) {
        var push,
            pushNeeded,
            pushing,
            reply,
            unsubd;
        unsubd = false;
        reply = Bacon.more;
        pushing = false;
        pushNeeded = false;
        push = function() {
          var value;
          pushNeeded = true;
          if (pushing) {
            return ;
          }
          pushing = true;
          while (pushNeeded) {
            pushNeeded = false;
            if ((reply !== Bacon.noMore) && !unsubd) {
              value = values[i++];
              reply = sink(toEvent(value));
              if (reply !== Bacon.noMore) {
                if (i === values.length) {
                  sink(endEvent());
                } else {
                  UpdateBarrier.afterTransaction(push);
                }
              }
            }
          }
          return pushing = false;
        };
        push();
        return function() {
          return unsubd = true;
        };
      });
    }
  };
  Bacon.EventStream.prototype.holdWhen = function(valve) {
    var putToHold,
        releaseHold,
        valve_;
    valve_ = valve.startWith(false);
    releaseHold = valve_.filter(function(x) {
      return !x;
    });
    putToHold = valve_.filter(_.id);
    return withDescription(this, "holdWhen", valve, this.filter(false).merge(valve_.flatMapConcat((function(_this) {
      return function(shouldHold) {
        if (!shouldHold) {
          return _this.takeUntil(putToHold);
        } else {
          return _this.scan([], (function(xs, x) {
            return xs.concat([x]);
          })).sampledBy(releaseHold).take(1).flatMap(Bacon.fromArray);
        }
      };
    })(this))));
  };
  Bacon.interval = function(delay, value) {
    if (value == null) {
      value = {};
    }
    return withDescription(Bacon, "interval", delay, value, Bacon.fromPoll(delay, function() {
      return nextEvent(value);
    }));
  };
  Bacon.$ = {};
  Bacon.$.asEventStream = function(eventName, selector, eventTransformer) {
    var ref;
    if (_.isFunction(selector)) {
      ref = [selector, void 0], eventTransformer = ref[0], selector = ref[1];
    }
    return withDescription(this.selector || this, "asEventStream", eventName, Bacon.fromBinder((function(_this) {
      return function(handler) {
        _this.on(eventName, selector, handler);
        return function() {
          return _this.off(eventName, selector, handler);
        };
      };
    })(this), eventTransformer));
  };
  if ((ref = typeof jQuery !== "undefined" && jQuery !== null ? jQuery : typeof Zepto !== "undefined" && Zepto !== null ? Zepto : void 0) != null) {
    ref.fn.asEventStream = Bacon.$.asEventStream;
  }
  Bacon.Observable.prototype.log = function() {
    var args;
    args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    this.subscribe(function(event) {
      return typeof console !== "undefined" && console !== null ? typeof console.log === "function" ? console.log.apply(console, slice.call(args).concat([event.log()])) : void 0 : void 0;
    });
    return this;
  };
  Bacon.repeatedly = function(delay, values) {
    var index;
    index = 0;
    return withDescription(Bacon, "repeatedly", delay, values, Bacon.fromPoll(delay, function() {
      return values[index++ % values.length];
    }));
  };
  Bacon.repeat = function(generator) {
    var index;
    index = 0;
    return Bacon.fromBinder(function(sink) {
      var flag,
          handleEvent,
          reply,
          subscribeNext,
          unsub;
      flag = false;
      reply = Bacon.more;
      unsub = function() {};
      handleEvent = function(event) {
        if (event.isEnd()) {
          if (!flag) {
            return flag = true;
          } else {
            return subscribeNext();
          }
        } else {
          return reply = sink(event);
        }
      };
      subscribeNext = function() {
        var next;
        flag = true;
        while (flag && reply !== Bacon.noMore) {
          next = generator(index++);
          flag = false;
          if (next) {
            unsub = next.subscribeInternal(handleEvent);
          } else {
            sink(endEvent());
          }
        }
        return flag = true;
      };
      subscribeNext();
      return function() {
        return unsub();
      };
    });
  };
  Bacon.retry = function(options) {
    var delay,
        error,
        finished,
        isRetryable,
        maxRetries,
        retries,
        source;
    if (!_.isFunction(options.source)) {
      throw new Exception("'source' option has to be a function");
    }
    source = options.source;
    retries = options.retries || 0;
    maxRetries = options.maxRetries || retries;
    delay = options.delay || function() {
      return 0;
    };
    isRetryable = options.isRetryable || function() {
      return true;
    };
    finished = false;
    error = null;
    return withDescription(Bacon, "retry", options, Bacon.repeat(function() {
      var context,
          pause,
          valueStream;
      if (finished) {
        return null;
      } else {
        valueStream = function() {
          return source().endOnError().withHandler(function(event) {
            if (event.isError()) {
              error = event;
              if (isRetryable(error.error) && retries > 0) {} else {
                finished = true;
                return this.push(event);
              }
            } else {
              if (event.hasValue()) {
                error = null;
                finished = true;
              }
              return this.push(event);
            }
          });
        };
        if (error) {
          context = {
            error: error.error,
            retriesDone: maxRetries - retries
          };
          pause = Bacon.later(delay(context)).filter(false);
          retries = retries - 1;
          return pause.concat(Bacon.once().flatMap(valueStream));
        } else {
          return valueStream();
        }
      }
    }));
  };
  Bacon.sequentially = function(delay, values) {
    var index;
    index = 0;
    return withDescription(Bacon, "sequentially", delay, values, Bacon.fromPoll(delay, function() {
      var value;
      value = values[index++];
      if (index < values.length) {
        return value;
      } else if (index === values.length) {
        return [value, endEvent()];
      } else {
        return endEvent();
      }
    }));
  };
  Bacon.Observable.prototype.skip = function(count) {
    return withDescription(this, "skip", count, this.withHandler(function(event) {
      if (!event.hasValue()) {
        return this.push(event);
      } else if (count > 0) {
        count--;
        return Bacon.more;
      } else {
        return this.push(event);
      }
    }));
  };
  Bacon.EventStream.prototype.skipUntil = function(starter) {
    var started;
    started = starter.take(1).map(true).toProperty(false);
    return withDescription(this, "skipUntil", starter, this.filter(started));
  };
  Bacon.EventStream.prototype.skipWhile = function() {
    var args,
        f,
        ok;
    f = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    assertObservableIsProperty(f);
    ok = false;
    return convertArgsToFunction(this, f, args, function(f) {
      return withDescription(this, "skipWhile", f, this.withHandler(function(event) {
        if (ok || !event.hasValue() || !f(event.value())) {
          if (event.hasValue()) {
            ok = true;
          }
          return this.push(event);
        } else {
          return Bacon.more;
        }
      }));
    });
  };
  Bacon.Observable.prototype.slidingWindow = function(n, minValues) {
    if (minValues == null) {
      minValues = 0;
    }
    return withDescription(this, "slidingWindow", n, minValues, this.scan([], (function(window, value) {
      return window.concat([value]).slice(-n);
    })).filter((function(values) {
      return values.length >= minValues;
    })));
  };
  Bacon.spy = function(spy) {
    return spys.push(spy);
  };
  spys = [];
  registerObs = function(obs) {
    var j,
        len1,
        spy;
    if (spys.length) {
      if (!registerObs.running) {
        try {
          registerObs.running = true;
          for (j = 0, len1 = spys.length; j < len1; j++) {
            spy = spys[j];
            spy(obs);
          }
        } finally {
          delete registerObs.running;
        }
      }
    }
    return void 0;
  };
  Bacon.Property.prototype.startWith = function(seed) {
    return withDescription(this, "startWith", seed, this.scan(seed, function(prev, next) {
      return next;
    }));
  };
  Bacon.EventStream.prototype.startWith = function(seed) {
    return withDescription(this, "startWith", seed, Bacon.once(seed).concat(this));
  };
  Bacon.Observable.prototype.takeWhile = function() {
    var args,
        f;
    f = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    assertObservableIsProperty(f);
    return convertArgsToFunction(this, f, args, function(f) {
      return withDescription(this, "takeWhile", f, this.withHandler(function(event) {
        if (event.filter(f)) {
          return this.push(event);
        } else {
          this.push(endEvent());
          return Bacon.noMore;
        }
      }));
    });
  };
  Bacon.update = function() {
    var i,
        initial,
        lateBindFirst,
        patterns;
    initial = arguments[0], patterns = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    lateBindFirst = function(f) {
      return function() {
        var args;
        args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
        return function(i) {
          return f.apply(null, [i].concat(args));
        };
      };
    };
    i = patterns.length - 1;
    while (i > 0) {
      if (!(patterns[i] instanceof Function)) {
        patterns[i] = (function(x) {
          return function() {
            return x;
          };
        })(patterns[i]);
      }
      patterns[i] = lateBindFirst(patterns[i]);
      i = i - 2;
    }
    return withDescription.apply(null, [Bacon, "update", initial].concat(slice.call(patterns), [Bacon.when.apply(Bacon, patterns).scan(initial, (function(x, f) {
      return f(x);
    }))]));
  };
  Bacon.zipAsArray = function() {
    var streams;
    streams = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    if (isArray(streams[0])) {
      streams = streams[0];
    }
    return withDescription.apply(null, [Bacon, "zipAsArray"].concat(slice.call(streams), [Bacon.zipWith(streams, function() {
      var xs;
      xs = 1 <= arguments.length ? slice.call(arguments, 0) : [];
      return xs;
    })]));
  };
  Bacon.zipWith = function() {
    var f,
        ref1,
        streams;
    f = arguments[0], streams = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    if (!_.isFunction(f)) {
      ref1 = [f, streams[0]], streams = ref1[0], f = ref1[1];
    }
    streams = _.map((function(s) {
      return s.toEventStream();
    }), streams);
    return withDescription.apply(null, [Bacon, "zipWith", f].concat(slice.call(streams), [Bacon.when(streams, f)]));
  };
  Bacon.Observable.prototype.zip = function(other, f) {
    if (f == null) {
      f = Array;
    }
    return withDescription(this, "zip", other, Bacon.zipWith([this, other], f));
  };
  Bacon.Observable.prototype.first = function() {
    return withDescription(this, "first", this.take(1));
  };
  Bacon.Observable.prototype.last = function() {
    var lastEvent;
    return withDescription(this, "last", this.withHandler(function(event) {
      if (event.isEnd()) {
        if (lastEvent) {
          this.push(lastEvent);
        }
        this.push(endEvent());
        return Bacon.noMore;
      } else {
        lastEvent = event;
      }
    }));
  };
  Bacon.EventStream.prototype.throttle = function(delay) {
    return withDescription(this, "throttle", delay, this.bufferWithTime(delay).map(function(values) {
      return values[values.length - 1];
    }));
  };
  Bacon.Property.prototype.throttle = function(delay) {
    return this.delayChanges("throttle", delay, function(changes) {
      return changes.throttle(delay);
    });
  };
  Observable.prototype.firstToPromise = function(PromiseCtr) {
    var _this = this;
    if (typeof PromiseCtr !== "function") {
      if (typeof Promise === "function") {
        PromiseCtr = Promise;
      } else {
        throw new Exception("There isn't default Promise, use shim or parameter");
      }
    }
    return new PromiseCtr(function(resolve, reject) {
      return _this.subscribe(function(event) {
        if (event.hasValue()) {
          resolve(event.value());
        }
        if (event.isError()) {
          reject(event.error);
        }
        return Bacon.noMore;
      });
    });
  };
  Observable.prototype.toPromise = function(PromiseCtr) {
    return this.last().firstToPromise(PromiseCtr);
  };
  if ((typeof define !== "undefined" && define !== null) && (define.amd != null)) {
    System.register("github:baconjs/bacon.js@0.7.58/dist/Bacon", [], false, function(__require, __exports, __module) {
      return (function() {
        return Bacon;
      }).call(this);
    });
    this.Bacon = Bacon;
  } else if ((typeof module !== "undefined" && module !== null) && (module.exports != null)) {
    module.exports = Bacon;
    Bacon.Bacon = Bacon;
  } else {
    this.Bacon = Bacon;
  }
}).call(this);
})();
System.register("npm:core-js@0.9.10/library/modules/$", ["npm:core-js@0.9.10/library/modules/$.fw"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var global = typeof self != 'undefined' ? self : Function('return this')(),
      core = {},
      defineProperty = Object.defineProperty,
      hasOwnProperty = {}.hasOwnProperty,
      ceil = Math.ceil,
      floor = Math.floor,
      max = Math.max,
      min = Math.min;
  var DESC = !!function() {
    try {
      return defineProperty({}, 'a', {get: function() {
          return 2;
        }}).a == 2;
    } catch (e) {}
  }();
  var hide = createDefiner(1);
  function toInteger(it) {
    return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
  }
  function desc(bitmap, value) {
    return {
      enumerable: !(bitmap & 1),
      configurable: !(bitmap & 2),
      writable: !(bitmap & 4),
      value: value
    };
  }
  function simpleSet(object, key, value) {
    object[key] = value;
    return object;
  }
  function createDefiner(bitmap) {
    return DESC ? function(object, key, value) {
      return $.setDesc(object, key, desc(bitmap, value));
    } : simpleSet;
  }
  function isObject(it) {
    return it !== null && (typeof it == 'object' || typeof it == 'function');
  }
  function isFunction(it) {
    return typeof it == 'function';
  }
  function assertDefined(it) {
    if (it == undefined)
      throw TypeError("Can't call method on  " + it);
    return it;
  }
  var $ = module.exports = require("npm:core-js@0.9.10/library/modules/$.fw")({
    g: global,
    core: core,
    html: global.document && document.documentElement,
    isObject: isObject,
    isFunction: isFunction,
    it: function(it) {
      return it;
    },
    that: function() {
      return this;
    },
    toInteger: toInteger,
    toLength: function(it) {
      return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0;
    },
    toIndex: function(index, length) {
      index = toInteger(index);
      return index < 0 ? max(index + length, 0) : min(index, length);
    },
    has: function(it, key) {
      return hasOwnProperty.call(it, key);
    },
    create: Object.create,
    getProto: Object.getPrototypeOf,
    DESC: DESC,
    desc: desc,
    getDesc: Object.getOwnPropertyDescriptor,
    setDesc: defineProperty,
    setDescs: Object.defineProperties,
    getKeys: Object.keys,
    getNames: Object.getOwnPropertyNames,
    getSymbols: Object.getOwnPropertySymbols,
    assertDefined: assertDefined,
    ES5Object: Object,
    toObject: function(it) {
      return $.ES5Object(assertDefined(it));
    },
    hide: hide,
    def: createDefiner(0),
    set: global.Symbol ? simpleSet : hide,
    each: [].forEach
  });
  if (typeof __e != 'undefined')
    __e = core;
  if (typeof __g != 'undefined')
    __g = global;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.wks", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.uid"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var global = require("npm:core-js@0.9.10/library/modules/$").g,
      store = {};
  module.exports = function(name) {
    return store[name] || (store[name] = global.Symbol && global.Symbol[name] || require("npm:core-js@0.9.10/library/modules/$.uid").safe('Symbol.' + name));
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.iter", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.cof", "npm:core-js@0.9.10/library/modules/$.assert", "npm:core-js@0.9.10/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      cof = require("npm:core-js@0.9.10/library/modules/$.cof"),
      assertObject = require("npm:core-js@0.9.10/library/modules/$.assert").obj,
      SYMBOL_ITERATOR = require("npm:core-js@0.9.10/library/modules/$.wks")('iterator'),
      FF_ITERATOR = '@@iterator',
      Iterators = {},
      IteratorPrototype = {};
  setIterator(IteratorPrototype, $.that);
  function setIterator(O, value) {
    $.hide(O, SYMBOL_ITERATOR, value);
    if (FF_ITERATOR in [])
      $.hide(O, FF_ITERATOR, value);
  }
  module.exports = {
    BUGGY: 'keys' in [] && !('next' in [].keys()),
    Iterators: Iterators,
    step: function(done, value) {
      return {
        value: value,
        done: !!done
      };
    },
    is: function(it) {
      var O = Object(it),
          Symbol = $.g.Symbol,
          SYM = Symbol && Symbol.iterator || FF_ITERATOR;
      return SYM in O || SYMBOL_ITERATOR in O || $.has(Iterators, cof.classof(O));
    },
    get: function(it) {
      var Symbol = $.g.Symbol,
          ext = it[Symbol && Symbol.iterator || FF_ITERATOR],
          getIter = ext || it[SYMBOL_ITERATOR] || Iterators[cof.classof(it)];
      return assertObject(getIter.call(it));
    },
    set: setIterator,
    create: function(Constructor, NAME, next, proto) {
      Constructor.prototype = $.create(proto || IteratorPrototype, {next: $.desc(1, next)});
      cof.set(Constructor, NAME + ' Iterator');
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.iter-define", ["npm:core-js@0.9.10/library/modules/$.def", "npm:core-js@0.9.10/library/modules/$.redef", "npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.cof", "npm:core-js@0.9.10/library/modules/$.iter", "npm:core-js@0.9.10/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $def = require("npm:core-js@0.9.10/library/modules/$.def"),
      $redef = require("npm:core-js@0.9.10/library/modules/$.redef"),
      $ = require("npm:core-js@0.9.10/library/modules/$"),
      cof = require("npm:core-js@0.9.10/library/modules/$.cof"),
      $iter = require("npm:core-js@0.9.10/library/modules/$.iter"),
      SYMBOL_ITERATOR = require("npm:core-js@0.9.10/library/modules/$.wks")('iterator'),
      FF_ITERATOR = '@@iterator',
      KEYS = 'keys',
      VALUES = 'values',
      Iterators = $iter.Iterators;
  module.exports = function(Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCE) {
    $iter.create(Constructor, NAME, next);
    function createMethod(kind) {
      function $$(that) {
        return new Constructor(that, kind);
      }
      switch (kind) {
        case KEYS:
          return function keys() {
            return $$(this);
          };
        case VALUES:
          return function values() {
            return $$(this);
          };
      }
      return function entries() {
        return $$(this);
      };
    }
    var TAG = NAME + ' Iterator',
        proto = Base.prototype,
        _native = proto[SYMBOL_ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT],
        _default = _native || createMethod(DEFAULT),
        methods,
        key;
    if (_native) {
      var IteratorPrototype = $.getProto(_default.call(new Base));
      cof.set(IteratorPrototype, TAG, true);
      if ($.FW && $.has(proto, FF_ITERATOR))
        $iter.set(IteratorPrototype, $.that);
    }
    if ($.FW)
      $iter.set(proto, _default);
    Iterators[NAME] = _default;
    Iterators[TAG] = $.that;
    if (DEFAULT) {
      methods = {
        keys: IS_SET ? _default : createMethod(KEYS),
        values: DEFAULT == VALUES ? _default : createMethod(VALUES),
        entries: DEFAULT != VALUES ? _default : createMethod('entries')
      };
      if (FORCE)
        for (key in methods) {
          if (!(key in proto))
            $redef(proto, key, methods[key]);
        }
      else
        $def($def.P + $def.F * $iter.BUGGY, NAME, methods);
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.array.iterator", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.unscope", "npm:core-js@0.9.10/library/modules/$.uid", "npm:core-js@0.9.10/library/modules/$.iter", "npm:core-js@0.9.10/library/modules/$.iter-define"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      setUnscope = require("npm:core-js@0.9.10/library/modules/$.unscope"),
      ITER = require("npm:core-js@0.9.10/library/modules/$.uid").safe('iter'),
      $iter = require("npm:core-js@0.9.10/library/modules/$.iter"),
      step = $iter.step,
      Iterators = $iter.Iterators;
  require("npm:core-js@0.9.10/library/modules/$.iter-define")(Array, 'Array', function(iterated, kind) {
    $.set(this, ITER, {
      o: $.toObject(iterated),
      i: 0,
      k: kind
    });
  }, function() {
    var iter = this[ITER],
        O = iter.o,
        kind = iter.k,
        index = iter.i++;
    if (!O || index >= O.length) {
      iter.o = undefined;
      return step(1);
    }
    if (kind == 'keys')
      return step(0, index);
    if (kind == 'values')
      return step(0, O[index]);
    return step(0, [index, O[index]]);
  }, 'values');
  Iterators.Arguments = Iterators.Array;
  setUnscope('keys');
  setUnscope('values');
  setUnscope('entries');
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.for-of", ["npm:core-js@0.9.10/library/modules/$.ctx", "npm:core-js@0.9.10/library/modules/$.iter", "npm:core-js@0.9.10/library/modules/$.iter-call"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var ctx = require("npm:core-js@0.9.10/library/modules/$.ctx"),
      get = require("npm:core-js@0.9.10/library/modules/$.iter").get,
      call = require("npm:core-js@0.9.10/library/modules/$.iter-call");
  module.exports = function(iterable, entries, fn, that) {
    var iterator = get(iterable),
        f = ctx(fn, that, entries ? 2 : 1),
        step;
    while (!(step = iterator.next()).done) {
      if (call(iterator, f, step.value, entries) === false) {
        return call.close(iterator);
      }
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:process@0.10.1", ["npm:process@0.10.1/browser"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:process@0.10.1/browser");
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.collection-weak", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.uid", "npm:core-js@0.9.10/library/modules/$.assert", "npm:core-js@0.9.10/library/modules/$.for-of", "npm:core-js@0.9.10/library/modules/$.array-methods", "npm:core-js@0.9.10/library/modules/$.mix"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      safe = require("npm:core-js@0.9.10/library/modules/$.uid").safe,
      assert = require("npm:core-js@0.9.10/library/modules/$.assert"),
      forOf = require("npm:core-js@0.9.10/library/modules/$.for-of"),
      _has = $.has,
      isObject = $.isObject,
      hide = $.hide,
      isFrozen = Object.isFrozen || $.core.Object.isFrozen,
      id = 0,
      ID = safe('id'),
      WEAK = safe('weak'),
      LEAK = safe('leak'),
      method = require("npm:core-js@0.9.10/library/modules/$.array-methods"),
      find = method(5),
      findIndex = method(6);
  function findFrozen(store, key) {
    return find(store.array, function(it) {
      return it[0] === key;
    });
  }
  function leakStore(that) {
    return that[LEAK] || hide(that, LEAK, {
      array: [],
      get: function(key) {
        var entry = findFrozen(this, key);
        if (entry)
          return entry[1];
      },
      has: function(key) {
        return !!findFrozen(this, key);
      },
      set: function(key, value) {
        var entry = findFrozen(this, key);
        if (entry)
          entry[1] = value;
        else
          this.array.push([key, value]);
      },
      'delete': function(key) {
        var index = findIndex(this.array, function(it) {
          return it[0] === key;
        });
        if (~index)
          this.array.splice(index, 1);
        return !!~index;
      }
    })[LEAK];
  }
  module.exports = {
    getConstructor: function(NAME, IS_MAP, ADDER) {
      function C() {
        $.set(assert.inst(this, C, NAME), ID, id++);
        var iterable = arguments[0];
        if (iterable != undefined)
          forOf(iterable, IS_MAP, this[ADDER], this);
      }
      require("npm:core-js@0.9.10/library/modules/$.mix")(C.prototype, {
        'delete': function(key) {
          if (!isObject(key))
            return false;
          if (isFrozen(key))
            return leakStore(this)['delete'](key);
          return _has(key, WEAK) && _has(key[WEAK], this[ID]) && delete key[WEAK][this[ID]];
        },
        has: function has(key) {
          if (!isObject(key))
            return false;
          if (isFrozen(key))
            return leakStore(this).has(key);
          return _has(key, WEAK) && _has(key[WEAK], this[ID]);
        }
      });
      return C;
    },
    def: function(that, key, value) {
      if (isFrozen(assert.obj(key))) {
        leakStore(that).set(key, value);
      } else {
        _has(key, WEAK) || hide(key, WEAK, {});
        key[WEAK][that[ID]] = value;
      }
      return that;
    },
    leakStore: leakStore,
    WEAK: WEAK,
    ID: ID
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/get-iterator", ["npm:core-js@0.9.10/library/modules/web.dom.iterable", "npm:core-js@0.9.10/library/modules/es6.string.iterator", "npm:core-js@0.9.10/library/modules/core.iter-helpers", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/web.dom.iterable");
  require("npm:core-js@0.9.10/library/modules/es6.string.iterator");
  require("npm:core-js@0.9.10/library/modules/core.iter-helpers");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.getIterator;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/weak-set", ["npm:core-js@0.9.10/library/modules/es6.object.to-string", "npm:core-js@0.9.10/library/modules/web.dom.iterable", "npm:core-js@0.9.10/library/modules/es6.weak-set", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.object.to-string");
  require("npm:core-js@0.9.10/library/modules/web.dom.iterable");
  require("npm:core-js@0.9.10/library/modules/es6.weak-set");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.WeakSet;
  global.define = __define;
  return module.exports;
});

(function() {
function define(){};  define.amd = {};
System.register("github:toji/gl-matrix@master", ["github:toji/gl-matrix@master/dist/gl-matrix"], false, function(__require, __exports, __module) {
  return (function(main) {
    return main;
  }).call(this, __require('github:toji/gl-matrix@master/dist/gl-matrix'));
});
})();
System.register("npm:core-js@0.9.10/library/fn/object/keys", ["npm:core-js@0.9.10/library/modules/es6.object.statics-accept-primitives", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.object.statics-accept-primitives");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.Object.keys;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/object/define-property", ["npm:core-js@0.9.10/library/fn/object/define-property"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/object/define-property"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.map", ["npm:core-js@0.9.10/library/modules/$.collection-strong", "npm:core-js@0.9.10/library/modules/$.collection"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var strong = require("npm:core-js@0.9.10/library/modules/$.collection-strong");
  require("npm:core-js@0.9.10/library/modules/$.collection")('Map', {
    get: function get(key) {
      var entry = strong.getEntry(this, key);
      return entry && entry.v;
    },
    set: function set(key, value) {
      return strong.def(this, key === 0 ? 0 : key, value);
    }
  }, strong, true);
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es7.map.to-json", ["npm:core-js@0.9.10/library/modules/$.collection-to-json"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/$.collection-to-json")('Map');
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/set", ["npm:core-js@0.9.10/library/modules/es6.object.to-string", "npm:core-js@0.9.10/library/modules/es6.string.iterator", "npm:core-js@0.9.10/library/modules/web.dom.iterable", "npm:core-js@0.9.10/library/modules/es6.set", "npm:core-js@0.9.10/library/modules/es7.set.to-json", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.object.to-string");
  require("npm:core-js@0.9.10/library/modules/es6.string.iterator");
  require("npm:core-js@0.9.10/library/modules/web.dom.iterable");
  require("npm:core-js@0.9.10/library/modules/es6.set");
  require("npm:core-js@0.9.10/library/modules/es7.set.to-json");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.Set;
  global.define = __define;
  return module.exports;
});

System.register("github:mrdoob/stats.js@master", ["github:mrdoob/stats.js@master/src/Stats"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("github:mrdoob/stats.js@master/src/Stats");
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/symbol/iterator", ["npm:core-js@0.9.10/library/fn/symbol/iterator"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/symbol/iterator"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.symbol", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.cof", "npm:core-js@0.9.10/library/modules/$.uid", "npm:core-js@0.9.10/library/modules/$.def", "npm:core-js@0.9.10/library/modules/$.redef", "npm:core-js@0.9.10/library/modules/$.keyof", "npm:core-js@0.9.10/library/modules/$.enum-keys", "npm:core-js@0.9.10/library/modules/$.assert", "npm:core-js@0.9.10/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      setTag = require("npm:core-js@0.9.10/library/modules/$.cof").set,
      uid = require("npm:core-js@0.9.10/library/modules/$.uid"),
      $def = require("npm:core-js@0.9.10/library/modules/$.def"),
      $redef = require("npm:core-js@0.9.10/library/modules/$.redef"),
      keyOf = require("npm:core-js@0.9.10/library/modules/$.keyof"),
      enumKeys = require("npm:core-js@0.9.10/library/modules/$.enum-keys"),
      assertObject = require("npm:core-js@0.9.10/library/modules/$.assert").obj,
      has = $.has,
      $create = $.create,
      getDesc = $.getDesc,
      setDesc = $.setDesc,
      desc = $.desc,
      getNames = $.getNames,
      toObject = $.toObject,
      $Symbol = $.g.Symbol,
      setter = false,
      TAG = uid('tag'),
      HIDDEN = uid('hidden'),
      _propertyIsEnumerable = {}.propertyIsEnumerable,
      SymbolRegistry = {},
      AllSymbols = {},
      useNative = $.isFunction($Symbol);
  function wrap(tag) {
    var sym = AllSymbols[tag] = $.set($create($Symbol.prototype), TAG, tag);
    $.DESC && setter && setDesc(Object.prototype, tag, {
      configurable: true,
      set: function(value) {
        if (has(this, HIDDEN) && has(this[HIDDEN], tag))
          this[HIDDEN][tag] = false;
        setDesc(this, tag, desc(1, value));
      }
    });
    return sym;
  }
  function defineProperty(it, key, D) {
    if (D && has(AllSymbols, key)) {
      if (!D.enumerable) {
        if (!has(it, HIDDEN))
          setDesc(it, HIDDEN, desc(1, {}));
        it[HIDDEN][key] = true;
      } else {
        if (has(it, HIDDEN) && it[HIDDEN][key])
          it[HIDDEN][key] = false;
        D = $create(D, {enumerable: desc(0, false)});
      }
    }
    return setDesc(it, key, D);
  }
  function defineProperties(it, P) {
    assertObject(it);
    var keys = enumKeys(P = toObject(P)),
        i = 0,
        l = keys.length,
        key;
    while (l > i)
      defineProperty(it, key = keys[i++], P[key]);
    return it;
  }
  function create(it, P) {
    return P === undefined ? $create(it) : defineProperties($create(it), P);
  }
  function propertyIsEnumerable(key) {
    var E = _propertyIsEnumerable.call(this, key);
    return E || !has(this, key) || !has(AllSymbols, key) || has(this, HIDDEN) && this[HIDDEN][key] ? E : true;
  }
  function getOwnPropertyDescriptor(it, key) {
    var D = getDesc(it = toObject(it), key);
    if (D && has(AllSymbols, key) && !(has(it, HIDDEN) && it[HIDDEN][key]))
      D.enumerable = true;
    return D;
  }
  function getOwnPropertyNames(it) {
    var names = getNames(toObject(it)),
        result = [],
        i = 0,
        key;
    while (names.length > i)
      if (!has(AllSymbols, key = names[i++]) && key != HIDDEN)
        result.push(key);
    return result;
  }
  function getOwnPropertySymbols(it) {
    var names = getNames(toObject(it)),
        result = [],
        i = 0,
        key;
    while (names.length > i)
      if (has(AllSymbols, key = names[i++]))
        result.push(AllSymbols[key]);
    return result;
  }
  if (!useNative) {
    $Symbol = function Symbol() {
      if (this instanceof $Symbol)
        throw TypeError('Symbol is not a constructor');
      return wrap(uid(arguments[0]));
    };
    $redef($Symbol.prototype, 'toString', function() {
      return this[TAG];
    });
    $.create = create;
    $.setDesc = defineProperty;
    $.getDesc = getOwnPropertyDescriptor;
    $.setDescs = defineProperties;
    $.getNames = getOwnPropertyNames;
    $.getSymbols = getOwnPropertySymbols;
    if ($.DESC && $.FW)
      $redef(Object.prototype, 'propertyIsEnumerable', propertyIsEnumerable, true);
  }
  var symbolStatics = {
    'for': function(key) {
      return has(SymbolRegistry, key += '') ? SymbolRegistry[key] : SymbolRegistry[key] = $Symbol(key);
    },
    keyFor: function keyFor(key) {
      return keyOf(SymbolRegistry, key);
    },
    useSetter: function() {
      setter = true;
    },
    useSimple: function() {
      setter = false;
    }
  };
  $.each.call(('hasInstance,isConcatSpreadable,iterator,match,replace,search,' + 'species,split,toPrimitive,toStringTag,unscopables').split(','), function(it) {
    var sym = require("npm:core-js@0.9.10/library/modules/$.wks")(it);
    symbolStatics[it] = useNative ? sym : wrap(sym);
  });
  setter = true;
  $def($def.G + $def.W, {Symbol: $Symbol});
  $def($def.S, 'Symbol', symbolStatics);
  $def($def.S + $def.F * !useNative, 'Object', {
    create: create,
    defineProperty: defineProperty,
    defineProperties: defineProperties,
    getOwnPropertyDescriptor: getOwnPropertyDescriptor,
    getOwnPropertyNames: getOwnPropertyNames,
    getOwnPropertySymbols: getOwnPropertySymbols
  });
  setTag($Symbol, 'Symbol');
  setTag(Math, 'Math', true);
  setTag($.g.JSON, 'JSON', true);
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/array/from", ["npm:core-js@0.9.10/library/modules/es6.string.iterator", "npm:core-js@0.9.10/library/modules/es6.array.from", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.string.iterator");
  require("npm:core-js@0.9.10/library/modules/es6.array.from");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.Array.from;
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/math/sign/index", ["npm:es5-ext@0.10.7/math/sign/is-implemented", "npm:es5-ext@0.10.7/math/sign/shim"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = require("npm:es5-ext@0.10.7/math/sign/is-implemented")() ? Math.sign : require("npm:es5-ext@0.10.7/math/sign/shim");
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/_iterate", ["npm:es5-ext@0.10.7/object/is-callable", "npm:es5-ext@0.10.7/object/valid-callable", "npm:es5-ext@0.10.7/object/valid-value"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var isCallable = require("npm:es5-ext@0.10.7/object/is-callable"),
      callable = require("npm:es5-ext@0.10.7/object/valid-callable"),
      value = require("npm:es5-ext@0.10.7/object/valid-value"),
      call = Function.prototype.call,
      keys = Object.keys,
      propertyIsEnumerable = Object.prototype.propertyIsEnumerable;
  module.exports = function(method, defVal) {
    return function(obj, cb) {
      var list,
          thisArg = arguments[2],
          compareFn = arguments[3];
      obj = Object(value(obj));
      callable(cb);
      list = keys(obj);
      if (compareFn) {
        list.sort(isCallable(compareFn) ? compareFn.bind(obj) : undefined);
      }
      return list[method](function(key, index) {
        if (!propertyIsEnumerable.call(obj, key))
          return defVal;
        return call.call(cb, thisArg, obj[key], key, obj, index);
      });
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/keys/index", ["npm:es5-ext@0.10.7/object/keys/is-implemented", "npm:es5-ext@0.10.7/object/keys/shim"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = require("npm:es5-ext@0.10.7/object/keys/is-implemented")() ? Object.keys : require("npm:es5-ext@0.10.7/object/keys/shim");
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/function/_define-length", ["npm:es5-ext@0.10.7/number/to-pos-integer", "npm:es5-ext@0.10.7/object/mixin"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toPosInt = require("npm:es5-ext@0.10.7/number/to-pos-integer"),
      test = function(a, b) {},
      desc,
      defineProperty,
      generate,
      mixin;
  try {
    Object.defineProperty(test, 'length', {
      configurable: true,
      writable: false,
      enumerable: false,
      value: 1
    });
  } catch (ignore) {}
  if (test.length === 1) {
    desc = {
      configurable: true,
      writable: false,
      enumerable: false
    };
    defineProperty = Object.defineProperty;
    module.exports = function(fn, length) {
      length = toPosInt(length);
      if (fn.length === length)
        return fn;
      desc.value = length;
      return defineProperty(fn, 'length', desc);
    };
  } else {
    mixin = require("npm:es5-ext@0.10.7/object/mixin");
    generate = (function() {
      var cache = [];
      return function(l) {
        var args,
            i = 0;
        if (cache[l])
          return cache[l];
        args = [];
        while (l--)
          args.push('a' + (++i).toString(36));
        return new Function('fn', 'return function (' + args.join(', ') + ') { return fn.apply(this, arguments); };');
      };
    }());
    module.exports = function(src, length) {
      var target;
      length = toPosInt(length);
      if (src.length === length)
        return src;
      target = generate(length)(src);
      try {
        mixin(target, src);
      } catch (ignore) {}
      return target;
    };
  }
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/string/#/contains/index", ["npm:es5-ext@0.10.7/string/#/contains/is-implemented", "npm:es5-ext@0.10.7/string/#/contains/shim"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = require("npm:es5-ext@0.10.7/string/#/contains/is-implemented")() ? String.prototype.contains : require("npm:es5-ext@0.10.7/string/#/contains/shim");
  global.define = __define;
  return module.exports;
});

System.register("npm:event-emitter@0.3.3", ["npm:event-emitter@0.3.3/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:event-emitter@0.3.3/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:es6-symbol@2.0.1/validate-symbol", ["npm:es6-symbol@2.0.1/is-symbol"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var isSymbol = require("npm:es6-symbol@2.0.1/is-symbol");
  module.exports = function(value) {
    if (!isSymbol(value))
      throw new TypeError(value + " is not a symbol");
    return value;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/function/is-function", ["npm:es5-ext@0.10.7/function/noop"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toString = Object.prototype.toString,
      id = toString.call(require("npm:es5-ext@0.10.7/function/noop"));
  module.exports = function(f) {
    return (typeof f === "function") && (toString.call(f) === id);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/normalizers/get", ["npm:es5-ext@0.10.7/array/#/e-index-of"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var indexOf = require("npm:es5-ext@0.10.7/array/#/e-index-of"),
      create = Object.create;
  module.exports = function() {
    var lastId = 0,
        map = [],
        cache = create(null);
    return {
      get: function(args) {
        var index = 0,
            set = map,
            i,
            length = args.length;
        if (length === 0)
          return set[length] || null;
        if ((set = set[length])) {
          while (index < (length - 1)) {
            i = indexOf.call(set[0], args[index]);
            if (i === -1)
              return null;
            set = set[1][i];
            ++index;
          }
          i = indexOf.call(set[0], args[index]);
          if (i === -1)
            return null;
          return set[1][i] || null;
        }
        return null;
      },
      set: function(args) {
        var index = 0,
            set = map,
            i,
            length = args.length;
        if (length === 0) {
          set[length] = ++lastId;
        } else {
          if (!set[length]) {
            set[length] = [[], []];
          }
          set = set[length];
          while (index < (length - 1)) {
            i = indexOf.call(set[0], args[index]);
            if (i === -1) {
              i = set[0].push(args[index]) - 1;
              set[1].push([[], []]);
            }
            set = set[1][i];
            ++index;
          }
          i = indexOf.call(set[0], args[index]);
          if (i === -1) {
            i = set[0].push(args[index]) - 1;
          }
          set[1][i] = ++lastId;
        }
        cache[lastId] = args;
        return lastId;
      },
      delete: function(id) {
        var index = 0,
            set = map,
            i,
            args = cache[id],
            length = args.length,
            path = [];
        if (length === 0) {
          delete set[length];
        } else if ((set = set[length])) {
          while (index < (length - 1)) {
            i = indexOf.call(set[0], args[index]);
            if (i === -1) {
              return ;
            }
            path.push(set, i);
            set = set[1][i];
            ++index;
          }
          i = indexOf.call(set[0], args[index]);
          if (i === -1) {
            return ;
          }
          id = set[1][i];
          set[0].splice(i, 1);
          set[1].splice(i, 1);
          while (!set[0].length && path.length) {
            i = path.pop();
            set = path.pop();
            set[0].splice(i, 1);
            set[1].splice(i, 1);
          }
        }
        delete cache[id];
      },
      clear: function() {
        map = [];
        cache = create(null);
      }
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:next-tick@0.2.2", ["npm:next-tick@0.2.2/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:next-tick@0.2.2/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:timers-ext@0.1.0/valid-timeout", ["npm:es5-ext@0.10.7/number/to-pos-integer", "npm:timers-ext@0.1.0/max-timeout"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toPosInt = require("npm:es5-ext@0.10.7/number/to-pos-integer"),
      maxTimeout = require("npm:timers-ext@0.1.0/max-timeout");
  module.exports = function(value) {
    value = toPosInt(value);
    if (value > maxTimeout)
      throw new TypeError(value + " exceeds maximum possible timeout");
    return value;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:lru-queue@0.1.0", ["npm:lru-queue@0.1.0/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:lru-queue@0.1.0/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.object.assign", ["npm:core-js@0.9.10/library/modules/$.def", "npm:core-js@0.9.10/library/modules/$.assign"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $def = require("npm:core-js@0.9.10/library/modules/$.def");
  $def($def.S, 'Object', {assign: require("npm:core-js@0.9.10/library/modules/$.assign")});
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/math/log2", ["npm:core-js@0.9.10/library/modules/es6.math", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.math");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.Math.log2;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/object/freeze", ["npm:core-js@0.9.10/library/fn/object/freeze"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/object/freeze"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

(function() {
function define(){};  define.amd = {};
System.register("github:baconjs/bacon.js@0.7.58", ["github:baconjs/bacon.js@0.7.58/dist/Bacon"], false, function(__require, __exports, __module) {
  return (function(main) {
    return main;
  }).call(this, __require('github:baconjs/bacon.js@0.7.58/dist/Bacon'));
});
})();
System.register("npm:core-js@0.9.10/library/fn/object/create", ["npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$");
  module.exports = function create(P, D) {
    return $.create(P, D);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.cof", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      TAG = require("npm:core-js@0.9.10/library/modules/$.wks")('toStringTag'),
      toString = {}.toString;
  function cof(it) {
    return toString.call(it).slice(8, -1);
  }
  cof.classof = function(it) {
    var O,
        T;
    return it == undefined ? it === undefined ? 'Undefined' : 'Null' : typeof(T = (O = Object(it))[TAG]) == 'string' ? T : cof(O);
  };
  cof.set = function(it, tag, stat) {
    if (it && !$.has(it = stat ? it : it.prototype, TAG))
      $.hide(it, TAG, tag);
  };
  module.exports = cof;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.string.iterator", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.string-at", "npm:core-js@0.9.10/library/modules/$.uid", "npm:core-js@0.9.10/library/modules/$.iter", "npm:core-js@0.9.10/library/modules/$.iter-define"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var set = require("npm:core-js@0.9.10/library/modules/$").set,
      $at = require("npm:core-js@0.9.10/library/modules/$.string-at")(true),
      ITER = require("npm:core-js@0.9.10/library/modules/$.uid").safe('iter'),
      $iter = require("npm:core-js@0.9.10/library/modules/$.iter"),
      step = $iter.step;
  require("npm:core-js@0.9.10/library/modules/$.iter-define")(String, 'String', function(iterated) {
    set(this, ITER, {
      o: String(iterated),
      i: 0
    });
  }, function() {
    var iter = this[ITER],
        O = iter.o,
        index = iter.i,
        point;
    if (index >= O.length)
      return step(1);
    point = $at(O, index);
    iter.i += point.length;
    return step(0, point);
  });
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/web.dom.iterable", ["npm:core-js@0.9.10/library/modules/es6.array.iterator", "npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.iter", "npm:core-js@0.9.10/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.array.iterator");
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      Iterators = require("npm:core-js@0.9.10/library/modules/$.iter").Iterators,
      ITERATOR = require("npm:core-js@0.9.10/library/modules/$.wks")('iterator'),
      ArrayValues = Iterators.Array,
      NodeList = $.g.NodeList;
  if ($.FW && NodeList && !(ITERATOR in NodeList.prototype)) {
    $.hide(NodeList.prototype, ITERATOR, ArrayValues);
  }
  Iterators.NodeList = ArrayValues;
  global.define = __define;
  return module.exports;
});

System.register("github:jspm/nodelibs-process@0.1.1/index", ["npm:process@0.10.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = System._nodeRequire ? process : require("npm:process@0.10.1");
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.weak-map", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.collection-weak", "npm:core-js@0.9.10/library/modules/$.collection", "npm:core-js@0.9.10/library/modules/$.redef"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = require("npm:core-js@0.9.10/library/modules/$"),
      weak = require("npm:core-js@0.9.10/library/modules/$.collection-weak"),
      leakStore = weak.leakStore,
      ID = weak.ID,
      WEAK = weak.WEAK,
      has = $.has,
      isObject = $.isObject,
      isFrozen = Object.isFrozen || $.core.Object.isFrozen,
      tmp = {};
  var WeakMap = require("npm:core-js@0.9.10/library/modules/$.collection")('WeakMap', {
    get: function get(key) {
      if (isObject(key)) {
        if (isFrozen(key))
          return leakStore(this).get(key);
        if (has(key, WEAK))
          return key[WEAK][this[ID]];
      }
    },
    set: function set(key, value) {
      return weak.def(this, key, value);
    }
  }, weak, true, true);
  if ($.FW && new WeakMap().set((Object.freeze || Object)(tmp), 7).get(tmp) != 7) {
    $.each.call(['delete', 'has', 'get', 'set'], function(key) {
      var method = WeakMap.prototype[key];
      require("npm:core-js@0.9.10/library/modules/$.redef")(WeakMap.prototype, key, function(a, b) {
        if (isObject(a) && isFrozen(a)) {
          var result = leakStore(this)[key](a, b);
          return key == 'set' ? this : result;
        }
        return method.call(this, a, b);
      });
    });
  }
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/get-iterator", ["npm:core-js@0.9.10/library/fn/get-iterator"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/get-iterator"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/weak-set", ["npm:core-js@0.9.10/library/fn/weak-set"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/weak-set"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/object/keys", ["npm:core-js@0.9.10/library/fn/object/keys"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/object/keys"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/helpers/create-class", ["npm:babel-runtime@5.4.3/core-js/object/define-property"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$defineProperty = require("npm:babel-runtime@5.4.3/core-js/object/define-property")["default"];
  exports["default"] = (function() {
    function defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor)
          descriptor.writable = true;
        _Object$defineProperty(target, descriptor.key, descriptor);
      }
    }
    return function(Constructor, protoProps, staticProps) {
      if (protoProps)
        defineProperties(Constructor.prototype, protoProps);
      if (staticProps)
        defineProperties(Constructor, staticProps);
      return Constructor;
    };
  })();
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/map", ["npm:core-js@0.9.10/library/modules/es6.object.to-string", "npm:core-js@0.9.10/library/modules/es6.string.iterator", "npm:core-js@0.9.10/library/modules/web.dom.iterable", "npm:core-js@0.9.10/library/modules/es6.map", "npm:core-js@0.9.10/library/modules/es7.map.to-json", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.object.to-string");
  require("npm:core-js@0.9.10/library/modules/es6.string.iterator");
  require("npm:core-js@0.9.10/library/modules/web.dom.iterable");
  require("npm:core-js@0.9.10/library/modules/es6.map");
  require("npm:core-js@0.9.10/library/modules/es7.map.to-json");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.Map;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/set", ["npm:core-js@0.9.10/library/fn/set"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/set"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/symbol/index", ["npm:core-js@0.9.10/library/modules/es6.symbol", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.symbol");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.Symbol;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/array/from", ["npm:core-js@0.9.10/library/fn/array/from"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/array/from"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/number/to-integer", ["npm:es5-ext@0.10.7/math/sign/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var sign = require("npm:es5-ext@0.10.7/math/sign/index"),
      abs = Math.abs,
      floor = Math.floor;
  module.exports = function(value) {
    if (isNaN(value))
      return 0;
    value = Number(value);
    if ((value === 0) || !isFinite(value))
      return value;
    return sign(value) * floor(abs(value));
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/for-each", ["npm:es5-ext@0.10.7/object/_iterate"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = require("npm:es5-ext@0.10.7/object/_iterate")('forEach');
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/assign/shim", ["npm:es5-ext@0.10.7/object/keys/index", "npm:es5-ext@0.10.7/object/valid-value"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var keys = require("npm:es5-ext@0.10.7/object/keys/index"),
      value = require("npm:es5-ext@0.10.7/object/valid-value"),
      max = Math.max;
  module.exports = function(dest, src) {
    var error,
        i,
        l = max(arguments.length, 2),
        assign;
    dest = Object(value(dest));
    assign = function(key) {
      try {
        dest[key] = src[key];
      } catch (e) {
        if (!error)
          error = e;
      }
    };
    for (i = 1; i < l; ++i) {
      src = arguments[i];
      keys(src).forEach(assign);
    }
    if (error !== undefined)
      throw error;
    return dest;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/string/#/contains", ["npm:es5-ext@0.10.7/string/#/contains/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:es5-ext@0.10.7/string/#/contains/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:es6-symbol@2.0.1/polyfill", ["npm:d@0.1.1", "npm:es6-symbol@2.0.1/validate-symbol"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var d = require("npm:d@0.1.1"),
      validateSymbol = require("npm:es6-symbol@2.0.1/validate-symbol"),
      create = Object.create,
      defineProperties = Object.defineProperties,
      defineProperty = Object.defineProperty,
      objPrototype = Object.prototype,
      Symbol,
      HiddenSymbol,
      globalSymbols = create(null);
  var generateName = (function() {
    var created = create(null);
    return function(desc) {
      var postfix = 0,
          name;
      while (created[desc + (postfix || '')])
        ++postfix;
      desc += (postfix || '');
      created[desc] = true;
      name = '@@' + desc;
      defineProperty(objPrototype, name, d.gs(null, function(value) {
        defineProperty(this, name, d(value));
      }));
      return name;
    };
  }());
  HiddenSymbol = function Symbol(description) {
    if (this instanceof HiddenSymbol)
      throw new TypeError('TypeError: Symbol is not a constructor');
    return Symbol(description);
  };
  module.exports = Symbol = function Symbol(description) {
    var symbol;
    if (this instanceof Symbol)
      throw new TypeError('TypeError: Symbol is not a constructor');
    symbol = create(HiddenSymbol.prototype);
    description = (description === undefined ? '' : String(description));
    return defineProperties(symbol, {
      __description__: d('', description),
      __name__: d('', generateName(description))
    });
  };
  defineProperties(Symbol, {
    for: d(function(key) {
      if (globalSymbols[key])
        return globalSymbols[key];
      return (globalSymbols[key] = Symbol(String(key)));
    }),
    keyFor: d(function(s) {
      var key;
      validateSymbol(s);
      for (key in globalSymbols)
        if (globalSymbols[key] === s)
          return key;
    }),
    hasInstance: d('', Symbol('hasInstance')),
    isConcatSpreadable: d('', Symbol('isConcatSpreadable')),
    iterator: d('', Symbol('iterator')),
    match: d('', Symbol('match')),
    replace: d('', Symbol('replace')),
    search: d('', Symbol('search')),
    species: d('', Symbol('species')),
    split: d('', Symbol('split')),
    toPrimitive: d('', Symbol('toPrimitive')),
    toStringTag: d('', Symbol('toStringTag')),
    unscopables: d('', Symbol('unscopables'))
  });
  defineProperties(HiddenSymbol.prototype, {
    constructor: d(Symbol),
    toString: d('', function() {
      return this.__name__;
    })
  });
  defineProperties(Symbol.prototype, {
    toString: d(function() {
      return 'Symbol (' + validateSymbol(this).__description__ + ')';
    }),
    valueOf: d(function() {
      return validateSymbol(this);
    })
  });
  defineProperty(Symbol.prototype, Symbol.toPrimitive, d('', function() {
    return validateSymbol(this);
  }));
  defineProperty(Symbol.prototype, Symbol.toStringTag, d('c', 'Symbol'));
  defineProperty(HiddenSymbol.prototype, Symbol.toPrimitive, d('c', Symbol.prototype[Symbol.toPrimitive]));
  defineProperty(HiddenSymbol.prototype, Symbol.toStringTag, d('c', Symbol.prototype[Symbol.toStringTag]));
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/ext/async", ["npm:es5-ext@0.10.7/array/from", "npm:es5-ext@0.10.7/object/mixin", "npm:es5-ext@0.10.7/function/_define-length", "npm:next-tick@0.2.2", "npm:memoizee@0.3.8/lib/registered-extensions", "github:jspm/nodelibs-process@0.1.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var aFrom = require("npm:es5-ext@0.10.7/array/from"),
        mixin = require("npm:es5-ext@0.10.7/object/mixin"),
        defineLength = require("npm:es5-ext@0.10.7/function/_define-length"),
        nextTick = require("npm:next-tick@0.2.2"),
        slice = Array.prototype.slice,
        apply = Function.prototype.apply,
        create = Object.create,
        hasOwnProperty = Object.prototype.hasOwnProperty;
    require("npm:memoizee@0.3.8/lib/registered-extensions").async = function(tbi, conf) {
      var waiting = create(null),
          cache = create(null),
          base = conf.memoized,
          original = conf.original,
          currentCallback,
          currentContext,
          currentArgs;
      conf.memoized = defineLength(function(arg) {
        var args = arguments,
            last = args[args.length - 1];
        if (typeof last === 'function') {
          currentCallback = last;
          args = slice.call(args, 0, -1);
        }
        return base.apply(currentContext = this, currentArgs = args);
      }, base);
      try {
        mixin(conf.memoized, base);
      } catch (ignore) {}
      conf.on('get', function(id) {
        var cb,
            context,
            args;
        if (!currentCallback)
          return ;
        if (waiting[id]) {
          if (typeof waiting[id] === 'function')
            waiting[id] = [waiting[id], currentCallback];
          else
            waiting[id].push(currentCallback);
          currentCallback = null;
          return ;
        }
        cb = currentCallback;
        context = currentContext;
        args = currentArgs;
        currentCallback = currentContext = currentArgs = null;
        nextTick(function() {
          var data;
          if (hasOwnProperty.call(cache, id)) {
            data = cache[id];
            conf.emit('getasync', id, args, context);
            apply.call(cb, data.context, data.args);
          } else {
            currentCallback = cb;
            currentContext = context;
            currentArgs = args;
            base.apply(context, args);
          }
        });
      });
      conf.original = function() {
        var args,
            cb,
            origCb,
            result;
        if (!currentCallback)
          return apply.call(original, this, arguments);
        args = aFrom(arguments);
        cb = function self(err) {
          var cb,
              args,
              id = self.id;
          if (id == null) {
            nextTick(apply.bind(self, this, arguments));
            return ;
          }
          delete self.id;
          cb = waiting[id];
          delete waiting[id];
          if (!cb) {
            return ;
          }
          args = aFrom(arguments);
          if (conf.has(id)) {
            if (err) {
              conf.delete(id);
            } else {
              cache[id] = {
                context: this,
                args: args
              };
              conf.emit('setasync', id, (typeof cb === 'function') ? 1 : cb.length);
            }
          }
          if (typeof cb === 'function') {
            result = apply.call(cb, this, args);
          } else {
            cb.forEach(function(cb) {
              result = apply.call(cb, this, args);
            }, this);
          }
          return result;
        };
        origCb = currentCallback;
        currentCallback = currentContext = currentArgs = null;
        args.push(cb);
        result = apply.call(original, this, args);
        cb.cb = origCb;
        currentCallback = cb;
        return result;
      };
      conf.on('set', function(id) {
        if (!currentCallback) {
          conf.delete(id);
          return ;
        }
        if (waiting[id]) {
          if (typeof waiting[id] === 'function')
            waiting[id] = [waiting[id], currentCallback.cb];
          else
            waiting[id].push(currentCallback.cb);
        } else {
          waiting[id] = currentCallback.cb;
        }
        delete currentCallback.cb;
        currentCallback.id = id;
        currentCallback = null;
      });
      conf.on('delete', function(id) {
        var result;
        if (hasOwnProperty.call(waiting, id))
          return ;
        if (!cache[id])
          return ;
        result = cache[id];
        delete cache[id];
        conf.emit('deleteasync', id, result);
      });
      conf.on('clear', function() {
        var oldCache = cache;
        cache = create(null);
        conf.emit('clearasync', oldCache);
      });
    };
  })(require("github:jspm/nodelibs-process@0.1.1"));
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/ext/max-age", ["npm:es5-ext@0.10.7/array/from", "npm:es5-ext@0.10.7/function/noop", "npm:es5-ext@0.10.7/object/for-each", "npm:timers-ext@0.1.0/valid-timeout", "npm:memoizee@0.3.8/lib/registered-extensions"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var aFrom = require("npm:es5-ext@0.10.7/array/from"),
      noop = require("npm:es5-ext@0.10.7/function/noop"),
      forEach = require("npm:es5-ext@0.10.7/object/for-each"),
      timeout = require("npm:timers-ext@0.1.0/valid-timeout"),
      extensions = require("npm:memoizee@0.3.8/lib/registered-extensions"),
      max = Math.max,
      min = Math.min,
      create = Object.create;
  extensions.maxAge = function(maxAge, conf, options) {
    var timeouts,
        postfix,
        preFetchAge,
        preFetchTimeouts;
    maxAge = timeout(maxAge);
    if (!maxAge)
      return ;
    timeouts = create(null);
    postfix = (options.async && extensions.async) ? 'async' : '';
    conf.on('set' + postfix, function(id) {
      timeouts[id] = setTimeout(function() {
        conf.delete(id);
      }, maxAge);
      if (!preFetchTimeouts)
        return ;
      if (preFetchTimeouts[id])
        clearTimeout(preFetchTimeouts[id]);
      preFetchTimeouts[id] = setTimeout(function() {
        delete preFetchTimeouts[id];
      }, preFetchAge);
    });
    conf.on('delete' + postfix, function(id) {
      clearTimeout(timeouts[id]);
      delete timeouts[id];
      if (!preFetchTimeouts)
        return ;
      clearTimeout(preFetchTimeouts[id]);
      delete preFetchTimeouts[id];
    });
    if (options.preFetch) {
      if ((options.preFetch === true) || isNaN(options.preFetch)) {
        preFetchAge = 0.333;
      } else {
        preFetchAge = max(min(Number(options.preFetch), 1), 0);
      }
      if (preFetchAge) {
        preFetchTimeouts = {};
        preFetchAge = (1 - preFetchAge) * maxAge;
        conf.on('get' + postfix, function(id, args, context) {
          if (!preFetchTimeouts[id]) {
            preFetchTimeouts[id] = setTimeout(function() {
              delete preFetchTimeouts[id];
              conf.delete(id);
              if (options.async) {
                args = aFrom(args);
                args.push(noop);
              }
              conf.memoized.apply(context, args);
            }, 0);
          }
        });
      }
    }
    conf.on('clear' + postfix, function() {
      forEach(timeouts, function(id) {
        clearTimeout(id);
      });
      timeouts = {};
      if (preFetchTimeouts) {
        forEach(preFetchTimeouts, function(id) {
          clearTimeout(id);
        });
        preFetchTimeouts = {};
      }
    });
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/ext/max", ["npm:es5-ext@0.10.7/number/to-pos-integer", "npm:lru-queue@0.1.0", "npm:memoizee@0.3.8/lib/registered-extensions"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toPosInteger = require("npm:es5-ext@0.10.7/number/to-pos-integer"),
      lruQueue = require("npm:lru-queue@0.1.0"),
      extensions = require("npm:memoizee@0.3.8/lib/registered-extensions");
  extensions.max = function(max, conf, options) {
    var postfix,
        queue,
        hit;
    max = toPosInteger(max);
    if (!max)
      return ;
    queue = lruQueue(max);
    postfix = (options.async && extensions.async) ? 'async' : '';
    conf.on('set' + postfix, hit = function(id) {
      id = queue.hit(id);
      if (id === undefined)
        return ;
      conf.delete(id);
    });
    conf.on('get' + postfix, hit);
    conf.on('delete' + postfix, queue.delete);
    conf.on('clear' + postfix, queue.clear);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/object/assign", ["npm:core-js@0.9.10/library/modules/es6.object.assign", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.object.assign");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.Object.assign;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/math/log2", ["npm:core-js@0.9.10/library/fn/math/log2"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/math/log2"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/object/create", ["npm:core-js@0.9.10/library/fn/object/create"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/object/create"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.object.to-string", ["npm:core-js@0.9.10/library/modules/$.cof", "npm:core-js@0.9.10/library/modules/$.wks", "npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.redef"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var cof = require("npm:core-js@0.9.10/library/modules/$.cof"),
      tmp = {};
  tmp[require("npm:core-js@0.9.10/library/modules/$.wks")('toStringTag')] = 'z';
  if (require("npm:core-js@0.9.10/library/modules/$").FW && cof(tmp) != 'z') {
    require("npm:core-js@0.9.10/library/modules/$.redef")(Object.prototype, 'toString', function toString() {
      return '[object ' + cof.classof(this) + ']';
    }, true);
  }
  global.define = __define;
  return module.exports;
});

System.register("github:jspm/nodelibs-process@0.1.1", ["github:jspm/nodelibs-process@0.1.1/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("github:jspm/nodelibs-process@0.1.1/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/weak-map", ["npm:core-js@0.9.10/library/modules/es6.object.to-string", "npm:core-js@0.9.10/library/modules/es6.array.iterator", "npm:core-js@0.9.10/library/modules/es6.weak-map", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.object.to-string");
  require("npm:core-js@0.9.10/library/modules/es6.array.iterator");
  require("npm:core-js@0.9.10/library/modules/es6.weak-map");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.WeakMap;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/map", ["npm:core-js@0.9.10/library/fn/map"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/map"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/symbol", ["npm:core-js@0.9.10/library/fn/symbol/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:core-js@0.9.10/library/fn/symbol/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/number/to-pos-integer", ["npm:es5-ext@0.10.7/number/to-integer"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toInteger = require("npm:es5-ext@0.10.7/number/to-integer"),
      max = Math.max;
  module.exports = function(value) {
    return max(0, toInteger(value));
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/object/assign/index", ["npm:es5-ext@0.10.7/object/assign/is-implemented", "npm:es5-ext@0.10.7/object/assign/shim"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = require("npm:es5-ext@0.10.7/object/assign/is-implemented")() ? Object.assign : require("npm:es5-ext@0.10.7/object/assign/shim");
  global.define = __define;
  return module.exports;
});

System.register("npm:d@0.1.1/index", ["npm:es5-ext@0.10.7/object/assign", "npm:es5-ext@0.10.7/object/normalize-options", "npm:es5-ext@0.10.7/object/is-callable", "npm:es5-ext@0.10.7/string/#/contains"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var assign = require("npm:es5-ext@0.10.7/object/assign"),
      normalizeOpts = require("npm:es5-ext@0.10.7/object/normalize-options"),
      isCallable = require("npm:es5-ext@0.10.7/object/is-callable"),
      contains = require("npm:es5-ext@0.10.7/string/#/contains"),
      d;
  d = module.exports = function(dscr, value) {
    var c,
        e,
        w,
        options,
        desc;
    if ((arguments.length < 2) || (typeof dscr !== 'string')) {
      options = value;
      value = dscr;
      dscr = null;
    } else {
      options = arguments[2];
    }
    if (dscr == null) {
      c = w = true;
      e = false;
    } else {
      c = contains.call(dscr, 'c');
      e = contains.call(dscr, 'e');
      w = contains.call(dscr, 'w');
    }
    desc = {
      value: value,
      configurable: c,
      enumerable: e,
      writable: w
    };
    return !options ? desc : assign(normalizeOpts(options), desc);
  };
  d.gs = function(dscr, get, set) {
    var c,
        e,
        options,
        desc;
    if (typeof dscr !== 'string') {
      options = set;
      set = get;
      get = dscr;
      dscr = null;
    } else {
      options = arguments[3];
    }
    if (get == null) {
      get = undefined;
    } else if (!isCallable(get)) {
      options = get;
      get = set = undefined;
    } else if (set == null) {
      set = undefined;
    } else if (!isCallable(set)) {
      options = set;
      set = undefined;
    }
    if (dscr == null) {
      c = true;
      e = false;
    } else {
      c = contains.call(dscr, 'c');
      e = contains.call(dscr, 'e');
    }
    desc = {
      get: get,
      set: set,
      configurable: c,
      enumerable: e
    };
    return !options ? desc : assign(normalizeOpts(options), desc);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es6-symbol@2.0.1/index", ["npm:es6-symbol@2.0.1/is-implemented", "npm:es6-symbol@2.0.1/polyfill"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = require("npm:es6-symbol@2.0.1/is-implemented")() ? Symbol : require("npm:es6-symbol@2.0.1/polyfill");
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/object/assign", ["npm:core-js@0.9.10/library/fn/object/assign"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/object/assign"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/helpers/inherits", ["npm:babel-runtime@5.4.3/core-js/object/create"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$create = require("npm:babel-runtime@5.4.3/core-js/object/create")["default"];
  exports["default"] = function(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
      throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
    }
    subClass.prototype = _Object$create(superClass && superClass.prototype, {constructor: {
        value: subClass,
        enumerable: false,
        writable: true,
        configurable: true
      }});
    if (superClass)
      subClass.__proto__ = superClass;
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/$.task", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.ctx", "npm:core-js@0.9.10/library/modules/$.cof", "npm:core-js@0.9.10/library/modules/$.invoke", "npm:core-js@0.9.10/library/modules/$.dom-create", "github:jspm/nodelibs-process@0.1.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = require("npm:core-js@0.9.10/library/modules/$"),
        ctx = require("npm:core-js@0.9.10/library/modules/$.ctx"),
        cof = require("npm:core-js@0.9.10/library/modules/$.cof"),
        invoke = require("npm:core-js@0.9.10/library/modules/$.invoke"),
        cel = require("npm:core-js@0.9.10/library/modules/$.dom-create"),
        global = $.g,
        isFunction = $.isFunction,
        html = $.html,
        process = global.process,
        setTask = global.setImmediate,
        clearTask = global.clearImmediate,
        postMessage = global.postMessage,
        addEventListener = global.addEventListener,
        MessageChannel = global.MessageChannel,
        counter = 0,
        queue = {},
        ONREADYSTATECHANGE = 'onreadystatechange',
        defer,
        channel,
        port;
    function run() {
      var id = +this;
      if ($.has(queue, id)) {
        var fn = queue[id];
        delete queue[id];
        fn();
      }
    }
    function listner(event) {
      run.call(event.data);
    }
    if (!isFunction(setTask) || !isFunction(clearTask)) {
      setTask = function(fn) {
        var args = [],
            i = 1;
        while (arguments.length > i)
          args.push(arguments[i++]);
        queue[++counter] = function() {
          invoke(isFunction(fn) ? fn : Function(fn), args);
        };
        defer(counter);
        return counter;
      };
      clearTask = function(id) {
        delete queue[id];
      };
      if (cof(process) == 'process') {
        defer = function(id) {
          process.nextTick(ctx(run, id, 1));
        };
      } else if (addEventListener && isFunction(postMessage) && !global.importScripts) {
        defer = function(id) {
          postMessage(id, '*');
        };
        addEventListener('message', listner, false);
      } else if (isFunction(MessageChannel)) {
        channel = new MessageChannel;
        port = channel.port2;
        channel.port1.onmessage = listner;
        defer = ctx(port.postMessage, port, 1);
      } else if (ONREADYSTATECHANGE in cel('script')) {
        defer = function(id) {
          html.appendChild(cel('script'))[ONREADYSTATECHANGE] = function() {
            html.removeChild(this);
            run.call(id);
          };
        };
      } else {
        defer = function(id) {
          setTimeout(ctx(run, id, 1), 0);
        };
      }
    }
    module.exports = {
      set: setTask,
      clear: clearTask
    };
  })(require("github:jspm/nodelibs-process@0.1.1"));
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/weak-map", ["npm:core-js@0.9.10/library/fn/weak-map"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/weak-map"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/symbol", ["npm:core-js@0.9.10/library/fn/symbol"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/symbol"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/lib/resolve-length", ["npm:es5-ext@0.10.7/number/to-pos-integer"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toPosInt = require("npm:es5-ext@0.10.7/number/to-pos-integer");
  module.exports = function(optsLength, fnLength, isAsync) {
    var length;
    if (isNaN(optsLength)) {
      length = fnLength;
      if (!(length >= 0))
        return 1;
      if (isAsync && length)
        return length - 1;
      return length;
    }
    if (optsLength === false)
      return false;
    return toPosInt(optsLength);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/error/custom", ["npm:es5-ext@0.10.7/object/assign/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var assign = require("npm:es5-ext@0.10.7/object/assign/index"),
      captureStackTrace = Error.captureStackTrace;
  exports = module.exports = function(message) {
    var err = new Error(),
        code = arguments[1],
        ext = arguments[2];
    if (ext == null) {
      if (code && (typeof code === 'object')) {
        ext = code;
        code = null;
      }
    }
    if (ext != null)
      assign(err, ext);
    err.message = String(message);
    if (code != null)
      err.code = String(code);
    if (captureStackTrace)
      captureStackTrace(err, exports);
    return err;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:d@0.1.1", ["npm:d@0.1.1/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:d@0.1.1/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:es6-symbol@2.0.1", ["npm:es6-symbol@2.0.1/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:es6-symbol@2.0.1/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/modules/es6.promise", ["npm:core-js@0.9.10/library/modules/$", "npm:core-js@0.9.10/library/modules/$.ctx", "npm:core-js@0.9.10/library/modules/$.cof", "npm:core-js@0.9.10/library/modules/$.def", "npm:core-js@0.9.10/library/modules/$.assert", "npm:core-js@0.9.10/library/modules/$.for-of", "npm:core-js@0.9.10/library/modules/$.set-proto", "npm:core-js@0.9.10/library/modules/$.species", "npm:core-js@0.9.10/library/modules/$.wks", "npm:core-js@0.9.10/library/modules/$.uid", "npm:core-js@0.9.10/library/modules/$.task", "npm:core-js@0.9.10/library/modules/$.mix", "npm:core-js@0.9.10/library/modules/$.iter-detect", "github:jspm/nodelibs-process@0.1.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = require("npm:core-js@0.9.10/library/modules/$"),
        ctx = require("npm:core-js@0.9.10/library/modules/$.ctx"),
        cof = require("npm:core-js@0.9.10/library/modules/$.cof"),
        $def = require("npm:core-js@0.9.10/library/modules/$.def"),
        assert = require("npm:core-js@0.9.10/library/modules/$.assert"),
        forOf = require("npm:core-js@0.9.10/library/modules/$.for-of"),
        setProto = require("npm:core-js@0.9.10/library/modules/$.set-proto").set,
        species = require("npm:core-js@0.9.10/library/modules/$.species"),
        SPECIES = require("npm:core-js@0.9.10/library/modules/$.wks")('species'),
        RECORD = require("npm:core-js@0.9.10/library/modules/$.uid").safe('record'),
        PROMISE = 'Promise',
        global = $.g,
        process = global.process,
        asap = process && process.nextTick || require("npm:core-js@0.9.10/library/modules/$.task").set,
        P = global[PROMISE],
        isFunction = $.isFunction,
        isObject = $.isObject,
        assertFunction = assert.fn,
        assertObject = assert.obj;
    var useNative = function() {
      var test,
          works = false;
      function P2(x) {
        var self = new P(x);
        setProto(self, P2.prototype);
        return self;
      }
      try {
        works = isFunction(P) && isFunction(P.resolve) && P.resolve(test = new P(function() {})) == test;
        setProto(P2, P);
        P2.prototype = $.create(P.prototype, {constructor: {value: P2}});
        if (!(P2.resolve(5).then(function() {}) instanceof P2)) {
          works = false;
        }
      } catch (e) {
        works = false;
      }
      return works;
    }();
    function getConstructor(C) {
      var S = assertObject(C)[SPECIES];
      return S != undefined ? S : C;
    }
    function isThenable(it) {
      var then;
      if (isObject(it))
        then = it.then;
      return isFunction(then) ? then : false;
    }
    function notify(record) {
      var chain = record.c;
      if (chain.length)
        asap(function() {
          var value = record.v,
              ok = record.s == 1,
              i = 0;
          function run(react) {
            var cb = ok ? react.ok : react.fail,
                ret,
                then;
            try {
              if (cb) {
                if (!ok)
                  record.h = true;
                ret = cb === true ? value : cb(value);
                if (ret === react.P) {
                  react.rej(TypeError('Promise-chain cycle'));
                } else if (then = isThenable(ret)) {
                  then.call(ret, react.res, react.rej);
                } else
                  react.res(ret);
              } else
                react.rej(value);
            } catch (err) {
              react.rej(err);
            }
          }
          while (chain.length > i)
            run(chain[i++]);
          chain.length = 0;
        });
    }
    function isUnhandled(promise) {
      var record = promise[RECORD],
          chain = record.a || record.c,
          i = 0,
          react;
      if (record.h)
        return false;
      while (chain.length > i) {
        react = chain[i++];
        if (react.fail || !isUnhandled(react.P))
          return false;
      }
      return true;
    }
    function $reject(value) {
      var record = this,
          promise;
      if (record.d)
        return ;
      record.d = true;
      record = record.r || record;
      record.v = value;
      record.s = 2;
      record.a = record.c.slice();
      setTimeout(function() {
        asap(function() {
          if (isUnhandled(promise = record.p)) {
            if (cof(process) == 'process') {
              process.emit('unhandledRejection', value, promise);
            } else if (global.console && isFunction(console.error)) {
              console.error('Unhandled promise rejection', value);
            }
          }
          record.a = undefined;
        });
      }, 1);
      notify(record);
    }
    function $resolve(value) {
      var record = this,
          then,
          wrapper;
      if (record.d)
        return ;
      record.d = true;
      record = record.r || record;
      try {
        if (then = isThenable(value)) {
          wrapper = {
            r: record,
            d: false
          };
          then.call(value, ctx($resolve, wrapper, 1), ctx($reject, wrapper, 1));
        } else {
          record.v = value;
          record.s = 1;
          notify(record);
        }
      } catch (err) {
        $reject.call(wrapper || {
          r: record,
          d: false
        }, err);
      }
    }
    if (!useNative) {
      P = function Promise(executor) {
        assertFunction(executor);
        var record = {
          p: assert.inst(this, P, PROMISE),
          c: [],
          a: undefined,
          s: 0,
          d: false,
          v: undefined,
          h: false
        };
        $.hide(this, RECORD, record);
        try {
          executor(ctx($resolve, record, 1), ctx($reject, record, 1));
        } catch (err) {
          $reject.call(record, err);
        }
      };
      require("npm:core-js@0.9.10/library/modules/$.mix")(P.prototype, {
        then: function then(onFulfilled, onRejected) {
          var S = assertObject(assertObject(this).constructor)[SPECIES];
          var react = {
            ok: isFunction(onFulfilled) ? onFulfilled : true,
            fail: isFunction(onRejected) ? onRejected : false
          };
          var promise = react.P = new (S != undefined ? S : P)(function(res, rej) {
            react.res = assertFunction(res);
            react.rej = assertFunction(rej);
          });
          var record = this[RECORD];
          record.c.push(react);
          if (record.a)
            record.a.push(react);
          record.s && notify(record);
          return promise;
        },
        'catch': function(onRejected) {
          return this.then(undefined, onRejected);
        }
      });
    }
    $def($def.G + $def.W + $def.F * !useNative, {Promise: P});
    cof.set(P, PROMISE);
    species(P);
    species($.core[PROMISE]);
    $def($def.S + $def.F * !useNative, PROMISE, {
      reject: function reject(r) {
        return new (getConstructor(this))(function(res, rej) {
          rej(r);
        });
      },
      resolve: function resolve(x) {
        return isObject(x) && RECORD in x && $.getProto(x) === this.prototype ? x : new (getConstructor(this))(function(res) {
          res(x);
        });
      }
    });
    $def($def.S + $def.F * !(useNative && require("npm:core-js@0.9.10/library/modules/$.iter-detect")(function(iter) {
      P.all(iter)['catch'](function() {});
    })), PROMISE, {
      all: function all(iterable) {
        var C = getConstructor(this),
            values = [];
        return new C(function(res, rej) {
          forOf(iterable, false, values.push, values);
          var remaining = values.length,
              results = Array(remaining);
          if (remaining)
            $.each.call(values, function(promise, index) {
              C.resolve(promise).then(function(value) {
                results[index] = value;
                --remaining || res(results);
              }, rej);
            });
          else
            res(results);
        });
      },
      race: function race(iterable) {
        var C = getConstructor(this);
        return new C(function(res, rej) {
          forOf(iterable, false, function(promise) {
            C.resolve(promise).then(res, rej);
          });
        });
      }
    });
  })(require("github:jspm/nodelibs-process@0.1.1"));
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/regenerator/runtime", ["npm:babel-runtime@5.4.3/core-js/symbol", "npm:babel-runtime@5.4.3/core-js/symbol/iterator", "npm:babel-runtime@5.4.3/core-js/object/create", "npm:babel-runtime@5.4.3/core-js/promise"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Symbol = require("npm:babel-runtime@5.4.3/core-js/symbol")["default"];
  var _Symbol$iterator = require("npm:babel-runtime@5.4.3/core-js/symbol/iterator")["default"];
  var _Object$create = require("npm:babel-runtime@5.4.3/core-js/object/create")["default"];
  var _Promise = require("npm:babel-runtime@5.4.3/core-js/promise")["default"];
  !(function(global) {
    "use strict";
    var hasOwn = Object.prototype.hasOwnProperty;
    var undefined;
    var iteratorSymbol = typeof _Symbol === "function" && _Symbol$iterator || "@@iterator";
    var inModule = typeof module === "object";
    var runtime = global.regeneratorRuntime;
    if (runtime) {
      if (inModule) {
        module.exports = runtime;
      }
      return ;
    }
    runtime = global.regeneratorRuntime = inModule ? module.exports : {};
    function wrap(innerFn, outerFn, self, tryLocsList) {
      var generator = _Object$create((outerFn || Generator).prototype);
      generator._invoke = makeInvokeMethod(innerFn, self || null, new Context(tryLocsList || []));
      return generator;
    }
    runtime.wrap = wrap;
    function tryCatch(fn, obj, arg) {
      try {
        return {
          type: "normal",
          arg: fn.call(obj, arg)
        };
      } catch (err) {
        return {
          type: "throw",
          arg: err
        };
      }
    }
    var GenStateSuspendedStart = "suspendedStart";
    var GenStateSuspendedYield = "suspendedYield";
    var GenStateExecuting = "executing";
    var GenStateCompleted = "completed";
    var ContinueSentinel = {};
    function Generator() {}
    function GeneratorFunction() {}
    function GeneratorFunctionPrototype() {}
    var Gp = GeneratorFunctionPrototype.prototype = Generator.prototype;
    GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
    GeneratorFunctionPrototype.constructor = GeneratorFunction;
    GeneratorFunction.displayName = "GeneratorFunction";
    runtime.isGeneratorFunction = function(genFun) {
      var ctor = typeof genFun === "function" && genFun.constructor;
      return ctor ? ctor === GeneratorFunction || (ctor.displayName || ctor.name) === "GeneratorFunction" : false;
    };
    runtime.mark = function(genFun) {
      genFun.__proto__ = GeneratorFunctionPrototype;
      genFun.prototype = _Object$create(Gp);
      return genFun;
    };
    runtime.async = function(innerFn, outerFn, self, tryLocsList) {
      return new _Promise(function(resolve, reject) {
        var generator = wrap(innerFn, outerFn, self, tryLocsList);
        var callNext = step.bind(generator, "next");
        var callThrow = step.bind(generator, "throw");
        function step(method, arg) {
          var record = tryCatch(generator[method], generator, arg);
          if (record.type === "throw") {
            reject(record.arg);
            return ;
          }
          var info = record.arg;
          if (info.done) {
            resolve(info.value);
          } else {
            _Promise.resolve(info.value).then(callNext, callThrow);
          }
        }
        callNext();
      });
    };
    function makeInvokeMethod(innerFn, self, context) {
      var state = GenStateSuspendedStart;
      return function invoke(method, arg) {
        if (state === GenStateExecuting) {
          throw new Error("Generator is already running");
        }
        if (state === GenStateCompleted) {
          return doneResult();
        }
        while (true) {
          var delegate = context.delegate;
          if (delegate) {
            if (method === "return" || method === "throw" && delegate.iterator[method] === undefined) {
              context.delegate = null;
              var returnMethod = delegate.iterator["return"];
              if (returnMethod) {
                var record = tryCatch(returnMethod, delegate.iterator, arg);
                if (record.type === "throw") {
                  method = "throw";
                  arg = record.arg;
                  continue;
                }
              }
              if (method === "return") {
                continue;
              }
            }
            var record = tryCatch(delegate.iterator[method], delegate.iterator, arg);
            if (record.type === "throw") {
              context.delegate = null;
              method = "throw";
              arg = record.arg;
              continue;
            }
            method = "next";
            arg = undefined;
            var info = record.arg;
            if (info.done) {
              context[delegate.resultName] = info.value;
              context.next = delegate.nextLoc;
            } else {
              state = GenStateSuspendedYield;
              return info;
            }
            context.delegate = null;
          }
          if (method === "next") {
            if (state === GenStateSuspendedYield) {
              context.sent = arg;
            } else {
              delete context.sent;
            }
          } else if (method === "throw") {
            if (state === GenStateSuspendedStart) {
              state = GenStateCompleted;
              throw arg;
            }
            if (context.dispatchException(arg)) {
              method = "next";
              arg = undefined;
            }
          } else if (method === "return") {
            context.abrupt("return", arg);
          }
          state = GenStateExecuting;
          var record = tryCatch(innerFn, self, context);
          if (record.type === "normal") {
            state = context.done ? GenStateCompleted : GenStateSuspendedYield;
            var info = {
              value: record.arg,
              done: context.done
            };
            if (record.arg === ContinueSentinel) {
              if (context.delegate && method === "next") {
                arg = undefined;
              }
            } else {
              return info;
            }
          } else if (record.type === "throw") {
            state = GenStateCompleted;
            method = "throw";
            arg = record.arg;
          }
        }
      };
    }
    function defineGeneratorMethod(method) {
      Gp[method] = function(arg) {
        return this._invoke(method, arg);
      };
    }
    defineGeneratorMethod("next");
    defineGeneratorMethod("throw");
    defineGeneratorMethod("return");
    Gp[iteratorSymbol] = function() {
      return this;
    };
    Gp.toString = function() {
      return "[object Generator]";
    };
    function pushTryEntry(locs) {
      var entry = {tryLoc: locs[0]};
      if (1 in locs) {
        entry.catchLoc = locs[1];
      }
      if (2 in locs) {
        entry.finallyLoc = locs[2];
        entry.afterLoc = locs[3];
      }
      this.tryEntries.push(entry);
    }
    function resetTryEntry(entry) {
      var record = entry.completion || {};
      record.type = "normal";
      delete record.arg;
      entry.completion = record;
    }
    function Context(tryLocsList) {
      this.tryEntries = [{tryLoc: "root"}];
      tryLocsList.forEach(pushTryEntry, this);
      this.reset();
    }
    runtime.keys = function(object) {
      var keys = [];
      for (var key in object) {
        keys.push(key);
      }
      keys.reverse();
      return function next() {
        while (keys.length) {
          var key = keys.pop();
          if (key in object) {
            next.value = key;
            next.done = false;
            return next;
          }
        }
        next.done = true;
        return next;
      };
    };
    function values(iterable) {
      if (iterable) {
        var iteratorMethod = iterable[iteratorSymbol];
        if (iteratorMethod) {
          return iteratorMethod.call(iterable);
        }
        if (typeof iterable.next === "function") {
          return iterable;
        }
        if (!isNaN(iterable.length)) {
          var i = -1,
              next = function next() {
                while (++i < iterable.length) {
                  if (hasOwn.call(iterable, i)) {
                    next.value = iterable[i];
                    next.done = false;
                    return next;
                  }
                }
                next.value = undefined;
                next.done = true;
                return next;
              };
          return next.next = next;
        }
      }
      return {next: doneResult};
    }
    runtime.values = values;
    function doneResult() {
      return {
        value: undefined,
        done: true
      };
    }
    Context.prototype = {
      constructor: Context,
      reset: function reset() {
        this.prev = 0;
        this.next = 0;
        this.sent = undefined;
        this.done = false;
        this.delegate = null;
        this.tryEntries.forEach(resetTryEntry);
        for (var tempIndex = 0,
            tempName; hasOwn.call(this, tempName = "t" + tempIndex) || tempIndex < 20; ++tempIndex) {
          this[tempName] = null;
        }
      },
      stop: function stop() {
        this.done = true;
        var rootEntry = this.tryEntries[0];
        var rootRecord = rootEntry.completion;
        if (rootRecord.type === "throw") {
          throw rootRecord.arg;
        }
        return this.rval;
      },
      dispatchException: function dispatchException(exception) {
        if (this.done) {
          throw exception;
        }
        var context = this;
        function handle(loc, caught) {
          record.type = "throw";
          record.arg = exception;
          context.next = loc;
          return !!caught;
        }
        for (var i = this.tryEntries.length - 1; i >= 0; --i) {
          var entry = this.tryEntries[i];
          var record = entry.completion;
          if (entry.tryLoc === "root") {
            return handle("end");
          }
          if (entry.tryLoc <= this.prev) {
            var hasCatch = hasOwn.call(entry, "catchLoc");
            var hasFinally = hasOwn.call(entry, "finallyLoc");
            if (hasCatch && hasFinally) {
              if (this.prev < entry.catchLoc) {
                return handle(entry.catchLoc, true);
              } else if (this.prev < entry.finallyLoc) {
                return handle(entry.finallyLoc);
              }
            } else if (hasCatch) {
              if (this.prev < entry.catchLoc) {
                return handle(entry.catchLoc, true);
              }
            } else if (hasFinally) {
              if (this.prev < entry.finallyLoc) {
                return handle(entry.finallyLoc);
              }
            } else {
              throw new Error("try statement without catch or finally");
            }
          }
        }
      },
      abrupt: function abrupt(type, arg) {
        for (var i = this.tryEntries.length - 1; i >= 0; --i) {
          var entry = this.tryEntries[i];
          if (entry.tryLoc <= this.prev && hasOwn.call(entry, "finallyLoc") && this.prev < entry.finallyLoc) {
            var finallyEntry = entry;
            break;
          }
        }
        if (finallyEntry && (type === "break" || type === "continue") && finallyEntry.tryLoc <= arg && arg <= finallyEntry.finallyLoc) {
          finallyEntry = null;
        }
        var record = finallyEntry ? finallyEntry.completion : {};
        record.type = type;
        record.arg = arg;
        if (finallyEntry) {
          this.next = finallyEntry.finallyLoc;
        } else {
          this.complete(record);
        }
        return ContinueSentinel;
      },
      complete: function complete(record, afterLoc) {
        if (record.type === "throw") {
          throw record.arg;
        }
        if (record.type === "break" || record.type === "continue") {
          this.next = record.arg;
        } else if (record.type === "return") {
          this.rval = record.arg;
          this.next = "end";
        } else if (record.type === "normal" && afterLoc) {
          this.next = afterLoc;
        }
        return ContinueSentinel;
      },
      finish: function finish(finallyLoc) {
        for (var i = this.tryEntries.length - 1; i >= 0; --i) {
          var entry = this.tryEntries[i];
          if (entry.finallyLoc === finallyLoc) {
            return this.complete(entry.completion, entry.afterLoc);
          }
        }
      },
      "catch": function _catch(tryLoc) {
        for (var i = this.tryEntries.length - 1; i >= 0; --i) {
          var entry = this.tryEntries[i];
          if (entry.tryLoc === tryLoc) {
            var record = entry.completion;
            if (record.type === "throw") {
              var thrown = record.arg;
              resetTryEntry(entry);
            }
            return thrown;
          }
        }
        throw new Error("illegal catch attempt");
      },
      delegateYield: function delegateYield(iterable, resultName, nextLoc) {
        this.delegate = {
          iterator: values(iterable),
          resultName: resultName,
          nextLoc: nextLoc
        };
        return ContinueSentinel;
      }
    };
  })(typeof global === "object" ? global : typeof window === "object" ? window : typeof self === "object" ? self : undefined);
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/array/from/shim", ["npm:es6-symbol@2.0.1", "npm:es5-ext@0.10.7/function/is-arguments", "npm:es5-ext@0.10.7/function/is-function", "npm:es5-ext@0.10.7/number/to-pos-integer", "npm:es5-ext@0.10.7/object/valid-callable", "npm:es5-ext@0.10.7/object/valid-value", "npm:es5-ext@0.10.7/string/is-string"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var iteratorSymbol = require("npm:es6-symbol@2.0.1").iterator,
      isArguments = require("npm:es5-ext@0.10.7/function/is-arguments"),
      isFunction = require("npm:es5-ext@0.10.7/function/is-function"),
      toPosInt = require("npm:es5-ext@0.10.7/number/to-pos-integer"),
      callable = require("npm:es5-ext@0.10.7/object/valid-callable"),
      validValue = require("npm:es5-ext@0.10.7/object/valid-value"),
      isString = require("npm:es5-ext@0.10.7/string/is-string"),
      isArray = Array.isArray,
      call = Function.prototype.call,
      desc = {
        configurable: true,
        enumerable: true,
        writable: true,
        value: null
      },
      defineProperty = Object.defineProperty;
  module.exports = function(arrayLike) {
    var mapFn = arguments[1],
        thisArg = arguments[2],
        Constructor,
        i,
        j,
        arr,
        l,
        code,
        iterator,
        result,
        getIterator,
        value;
    arrayLike = Object(validValue(arrayLike));
    if (mapFn != null)
      callable(mapFn);
    if (!this || (this === Array) || !isFunction(this)) {
      if (!mapFn) {
        if (isArguments(arrayLike)) {
          l = arrayLike.length;
          if (l !== 1)
            return Array.apply(null, arrayLike);
          arr = new Array(1);
          arr[0] = arrayLike[0];
          return arr;
        }
        if (isArray(arrayLike)) {
          arr = new Array(l = arrayLike.length);
          for (i = 0; i < l; ++i)
            arr[i] = arrayLike[i];
          return arr;
        }
      }
      arr = [];
    } else {
      Constructor = this;
    }
    if (!isArray(arrayLike)) {
      if ((getIterator = arrayLike[iteratorSymbol]) !== undefined) {
        iterator = callable(getIterator).call(arrayLike);
        if (Constructor)
          arr = new Constructor();
        result = iterator.next();
        i = 0;
        while (!result.done) {
          value = mapFn ? call.call(mapFn, thisArg, result.value, i) : result.value;
          if (!Constructor) {
            arr[i] = value;
          } else {
            desc.value = value;
            defineProperty(arr, i, desc);
          }
          result = iterator.next();
          ++i;
        }
        l = i;
      } else if (isString(arrayLike)) {
        l = arrayLike.length;
        if (Constructor)
          arr = new Constructor();
        for (i = 0, j = 0; i < l; ++i) {
          value = arrayLike[i];
          if ((i + 1) < l) {
            code = value.charCodeAt(0);
            if ((code >= 0xD800) && (code <= 0xDBFF))
              value += arrayLike[++i];
          }
          value = mapFn ? call.call(mapFn, thisArg, value, j) : value;
          if (!Constructor) {
            arr[j] = value;
          } else {
            desc.value = value;
            defineProperty(arr, j, desc);
          }
          ++j;
        }
        l = j;
      }
    }
    if (l === undefined) {
      l = toPosInt(arrayLike.length);
      if (Constructor)
        arr = new Constructor(l);
      for (i = 0; i < l; ++i) {
        value = mapFn ? call.call(mapFn, thisArg, arrayLike[i], i) : arrayLike[i];
        if (!Constructor) {
          arr[i] = value;
        } else {
          desc.value = value;
          defineProperty(arr, i, desc);
        }
      }
    }
    if (Constructor) {
      desc.value = null;
      arr.length = l;
    }
    return arr;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.10/library/fn/promise", ["npm:core-js@0.9.10/library/modules/es6.object.to-string", "npm:core-js@0.9.10/library/modules/es6.string.iterator", "npm:core-js@0.9.10/library/modules/web.dom.iterable", "npm:core-js@0.9.10/library/modules/es6.promise", "npm:core-js@0.9.10/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.10/library/modules/es6.object.to-string");
  require("npm:core-js@0.9.10/library/modules/es6.string.iterator");
  require("npm:core-js@0.9.10/library/modules/web.dom.iterable");
  require("npm:core-js@0.9.10/library/modules/es6.promise");
  module.exports = require("npm:core-js@0.9.10/library/modules/$").core.Promise;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/regenerator/index", ["npm:babel-runtime@5.4.3/regenerator/runtime"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var g = typeof global === "object" ? global : typeof window === "object" ? window : typeof self === "object" ? self : this;
  var hadRuntime = g.regeneratorRuntime && Object.getOwnPropertyNames(g).indexOf("regeneratorRuntime") >= 0;
  var oldRuntime = hadRuntime && g.regeneratorRuntime;
  delete g.regeneratorRuntime;
  module.exports = require("npm:babel-runtime@5.4.3/regenerator/runtime");
  if (hadRuntime) {
    g.regeneratorRuntime = oldRuntime;
  } else {
    delete g.regeneratorRuntime;
  }
  module.exports = {
    "default": module.exports,
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/array/from/index", ["npm:es5-ext@0.10.7/array/from/is-implemented", "npm:es5-ext@0.10.7/array/from/shim"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = require("npm:es5-ext@0.10.7/array/from/is-implemented")() ? Array.from : require("npm:es5-ext@0.10.7/array/from/shim");
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/core-js/promise", ["npm:core-js@0.9.10/library/fn/promise"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.10/library/fn/promise"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.3/regenerator", ["npm:babel-runtime@5.4.3/regenerator/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:babel-runtime@5.4.3/regenerator/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:es5-ext@0.10.7/array/to-array", ["npm:es5-ext@0.10.7/array/from/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var from = require("npm:es5-ext@0.10.7/array/from/index"),
      isArray = Array.isArray;
  module.exports = function(arrayLike) {
    return isArray(arrayLike) ? arrayLike : from(arrayLike);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/lib/resolve-resolve", ["npm:es5-ext@0.10.7/array/to-array", "npm:es5-ext@0.10.7/object/valid-callable"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var toArray = require("npm:es5-ext@0.10.7/array/to-array"),
      callable = require("npm:es5-ext@0.10.7/object/valid-callable"),
      slice = Array.prototype.slice,
      resolveArgs;
  resolveArgs = function(args) {
    return this.map(function(r, i) {
      return r ? r(args[i]) : args[i];
    }).concat(slice.call(args, this.length));
  };
  module.exports = function(resolvers) {
    resolvers = toArray(resolvers);
    resolvers.forEach(function(r) {
      if (r != null)
        callable(r);
    });
    return resolveArgs.bind(resolvers);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/lib/configure-map", ["npm:es5-ext@0.10.7/error/custom", "npm:es5-ext@0.10.7/function/_define-length", "npm:d@0.1.1", "npm:event-emitter@0.3.3", "npm:memoizee@0.3.8/lib/resolve-resolve", "npm:memoizee@0.3.8/lib/resolve-normalize"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var customError = require("npm:es5-ext@0.10.7/error/custom"),
      defineLength = require("npm:es5-ext@0.10.7/function/_define-length"),
      d = require("npm:d@0.1.1"),
      ee = require("npm:event-emitter@0.3.3").methods,
      resolveResolve = require("npm:memoizee@0.3.8/lib/resolve-resolve"),
      resolveNormalize = require("npm:memoizee@0.3.8/lib/resolve-normalize"),
      apply = Function.prototype.apply,
      call = Function.prototype.call,
      create = Object.create,
      hasOwnProperty = Object.prototype.hasOwnProperty,
      defineProperties = Object.defineProperties,
      on = ee.on,
      emit = ee.emit;
  module.exports = function(original, length, options) {
    var cache = create(null),
        conf,
        memLength,
        get,
        set,
        del,
        clear,
        extDel,
        normalizer,
        getListeners,
        setListeners,
        deleteListeners,
        memoized,
        resolve;
    if (length !== false)
      memLength = length;
    else if (isNaN(original.length))
      memLength = 1;
    else
      memLength = original.length;
    if (options.normalizer) {
      normalizer = resolveNormalize(options.normalizer);
      get = normalizer.get;
      set = normalizer.set;
      del = normalizer.delete;
      clear = normalizer.clear;
    }
    if (options.resolvers != null)
      resolve = resolveResolve(options.resolvers);
    if (get) {
      memoized = defineLength(function(arg) {
        var id,
            result,
            args = arguments;
        if (resolve)
          args = resolve(args);
        id = get(args);
        if (id !== null) {
          if (hasOwnProperty.call(cache, id)) {
            if (getListeners)
              conf.emit('get', id, args, this);
            return cache[id];
          }
        }
        if (args.length === 1)
          result = call.call(original, this, arg);
        else
          result = apply.call(original, this, args);
        if (id === null) {
          id = get(args);
          if (id !== null)
            throw customError("Circular invocation", 'CIRCULAR_INVOCATION');
          id = set(args);
        } else if (hasOwnProperty.call(cache, id)) {
          throw customError("Circular invocation", 'CIRCULAR_INVOCATION');
        }
        cache[id] = result;
        if (setListeners)
          conf.emit('set', id);
        return result;
      }, memLength);
    } else if (length === 0) {
      memoized = function() {
        var result;
        if (hasOwnProperty.call(cache, 'data')) {
          if (getListeners)
            conf.emit('get', 'data', arguments, this);
          return cache.data;
        }
        if (!arguments.length)
          result = call.call(original, this);
        else
          result = apply.call(original, this, arguments);
        if (hasOwnProperty.call(cache, 'data')) {
          throw customError("Circular invocation", 'CIRCULAR_INVOCATION');
        }
        cache.data = result;
        if (setListeners)
          conf.emit('set', 'data');
        return result;
      };
    } else {
      memoized = function(arg) {
        var result,
            args = arguments,
            id;
        if (resolve)
          args = resolve(arguments);
        id = String(args[0]);
        if (hasOwnProperty.call(cache, id)) {
          if (getListeners)
            conf.emit('get', id, args, this);
          return cache[id];
        }
        if (args.length === 1)
          result = call.call(original, this, args[0]);
        else
          result = apply.call(original, this, args);
        if (hasOwnProperty.call(cache, id)) {
          throw customError("Circular invocation", 'CIRCULAR_INVOCATION');
        }
        cache[id] = result;
        if (setListeners)
          conf.emit('set', id);
        return result;
      };
    }
    conf = {
      original: original,
      memoized: memoized,
      get: function(args) {
        if (resolve)
          args = resolve(args);
        if (get)
          return get(args);
        return String(args[0]);
      },
      has: function(id) {
        return hasOwnProperty.call(cache, id);
      },
      delete: function(id) {
        var result;
        if (!hasOwnProperty.call(cache, id))
          return ;
        if (del)
          del(id);
        result = cache[id];
        delete cache[id];
        if (deleteListeners)
          conf.emit('delete', id, result);
      },
      clear: function() {
        var oldCache = cache;
        if (clear)
          clear();
        cache = create(null);
        conf.emit('clear', oldCache);
      },
      on: function(type, listener) {
        if (type === 'get')
          getListeners = true;
        else if (type === 'set')
          setListeners = true;
        else if (type === 'delete')
          deleteListeners = true;
        return on.call(this, type, listener);
      },
      emit: emit,
      updateEnv: function() {
        original = conf.original;
      }
    };
    if (get) {
      extDel = defineLength(function(arg) {
        var id,
            args = arguments;
        if (resolve)
          args = resolve(args);
        id = get(args);
        if (id === null)
          return ;
        conf.delete(id);
      }, memLength);
    } else if (length === 0) {
      extDel = function() {
        return conf.delete('data');
      };
    } else {
      extDel = function(arg) {
        if (resolve)
          arg = resolve(arguments)[0];
        return conf.delete(arg);
      };
    }
    defineProperties(memoized, {
      __memoized__: d(true),
      delete: d(extDel),
      clear: d(conf.clear)
    });
    return conf;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/plain", ["npm:es5-ext@0.10.7/object/valid-callable", "npm:es5-ext@0.10.7/object/for-each", "npm:memoizee@0.3.8/lib/registered-extensions", "npm:memoizee@0.3.8/lib/configure-map", "npm:memoizee@0.3.8/lib/resolve-length"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var callable = require("npm:es5-ext@0.10.7/object/valid-callable"),
      forEach = require("npm:es5-ext@0.10.7/object/for-each"),
      extensions = require("npm:memoizee@0.3.8/lib/registered-extensions"),
      configure = require("npm:memoizee@0.3.8/lib/configure-map"),
      resolveLength = require("npm:memoizee@0.3.8/lib/resolve-length"),
      hasOwnProperty = Object.prototype.hasOwnProperty;
  module.exports = function self(fn) {
    var options,
        length,
        conf;
    callable(fn);
    options = Object(arguments[1]);
    if (hasOwnProperty.call(fn, '__memoized__') && !options.force)
      return fn;
    length = resolveLength(options.length, fn.length, options.async && extensions.async);
    conf = configure(fn, length, options);
    forEach(extensions, function(fn, name) {
      if (options[name])
        fn(options[name], conf, options);
    });
    if (self.__profiler__)
      self.__profiler__(conf);
    conf.updateEnv();
    return conf.memoized;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8/index", ["npm:es5-ext@0.10.7/object/normalize-options", "npm:memoizee@0.3.8/lib/resolve-length", "npm:memoizee@0.3.8/plain", "npm:memoizee@0.3.8/normalizers/primitive", "npm:memoizee@0.3.8/normalizers/get-primitive-fixed", "npm:memoizee@0.3.8/normalizers/get", "npm:memoizee@0.3.8/normalizers/get-1", "npm:memoizee@0.3.8/normalizers/get-fixed", "npm:memoizee@0.3.8/ext/async", "npm:memoizee@0.3.8/ext/dispose", "npm:memoizee@0.3.8/ext/max-age", "npm:memoizee@0.3.8/ext/max", "npm:memoizee@0.3.8/ext/ref-counter"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var normalizeOpts = require("npm:es5-ext@0.10.7/object/normalize-options"),
      resolveLength = require("npm:memoizee@0.3.8/lib/resolve-length"),
      plain = require("npm:memoizee@0.3.8/plain");
  module.exports = function(fn) {
    var options = normalizeOpts(arguments[1]),
        length;
    if (!options.normalizer) {
      length = options.length = resolveLength(options.length, fn.length, options.async);
      if (length !== 0) {
        if (options.primitive) {
          if (length === false) {
            options.normalizer = require("npm:memoizee@0.3.8/normalizers/primitive");
          } else if (length > 1) {
            options.normalizer = require("npm:memoizee@0.3.8/normalizers/get-primitive-fixed")(length);
          }
        } else {
          if (length === false)
            options.normalizer = require("npm:memoizee@0.3.8/normalizers/get")();
          else if (length === 1)
            options.normalizer = require("npm:memoizee@0.3.8/normalizers/get-1")();
          else
            options.normalizer = require("npm:memoizee@0.3.8/normalizers/get-fixed")(length);
        }
      }
    }
    if (options.async)
      require("npm:memoizee@0.3.8/ext/async");
    if (options.dispose)
      require("npm:memoizee@0.3.8/ext/dispose");
    if (options.maxAge)
      require("npm:memoizee@0.3.8/ext/max-age");
    if (options.max)
      require("npm:memoizee@0.3.8/ext/max");
    if (options.refCounter)
      require("npm:memoizee@0.3.8/ext/ref-counter");
    return plain(fn, options);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:memoizee@0.3.8", ["npm:memoizee@0.3.8/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:memoizee@0.3.8/index");
  global.define = __define;
  return module.exports;
});

System.register('lib/camera/perspective-camera', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'lib/camera/base', 'github:toji/gl-matrix@master'], function (_export) {
    var _inherits, _classCallCheck, Camera, glm, deg2rad, PerspectiveCamera;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_libCameraBase) {
            Camera = _libCameraBase['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }],
        execute: function () {
            'use strict';

            deg2rad = Math.PI / 180;

            PerspectiveCamera = (function (_Camera) {
                function PerspectiveCamera() {
                    var options = arguments[0] === undefined ? {} : arguments[0];

                    _classCallCheck(this, PerspectiveCamera);

                    _Camera.call(this, options);
                    var _options$fov = options.fov;
                    var fov = _options$fov === undefined ? 60 : _options$fov;
                    var _options$aspect = options.aspect;
                    var aspect = _options$aspect === undefined ? 4 / 3 : _options$aspect;
                    var _options$near = options.near;
                    var near = _options$near === undefined ? 0.1 : _options$near;
                    var _options$far = options.far;
                    var far = _options$far === undefined ? 100 : _options$far;

                    this.fov = fov;
                    this.aspect = aspect;
                    this.near = near;
                    this.far = far;

                    // Used for dirty checking
                    this._lastFov = this.fov;
                    this._lastAspect = this.aspect;
                    this._lastNear = this.near;
                    this._lastFar = this.far;

                    //  Object.seal(this);
                }

                _inherits(PerspectiveCamera, _Camera);

                PerspectiveCamera.prototype.recalculate = function recalculate(existingNodes) {
                    this.dirty = this.dirty || this.parent !== null && this.parent.dirty || this.fov !== this._lastFov || this.aspect !== this._lastAspect || this.near !== this._lastNear || this.far !== this._lastFar;

                    if (this.dirty) {
                        glm.mat4.perspective(this.projectionMatrix, this.fov * deg2rad, this.aspect, this.near, this.far);

                        this._lastFov = this.fov;
                        this._lastAspect = this.aspect;
                        this._lastNear = this.near;
                        this._lastFar = this.far;
                    }

                    return _Camera.prototype.recalculate.call(this, existingNodes);
                };

                return PerspectiveCamera;
            })(Camera);

            _export('default', PerspectiveCamera);
        }
    };
});
System.register("lib/webgl/buffer", ["npm:babel-runtime@5.4.3/helpers/class-call-check"], function (_export) {
    var _classCallCheck, GL, GLBuffer;

    return {
        setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck["default"];
        }],
        execute: function () {
            "use strict";

            GL = WebGLRenderingContext;

            GLBuffer = (function () {
                function GLBuffer(gl, data, vao) {
                    var _ref = arguments[3] === undefined ? {} : arguments[3];

                    var _ref$mode = _ref.mode;
                    var mode = _ref$mode === undefined ? GL.STATIC_DRAW : _ref$mode;
                    var _ref$size = _ref.size;
                    var size = _ref$size === undefined ? 3 : _ref$size;
                    var _ref$bufferType = _ref.bufferType;
                    var bufferType = _ref$bufferType === undefined ? GL.ARRAY_BUFFER : _ref$bufferType;
                    var _ref$dataType = _ref.dataType;
                    var dataType = _ref$dataType === undefined ? GL.FLOAT : _ref$dataType;

                    _classCallCheck(this, GLBuffer);

                    this.gl = gl;

                    if (vao !== undefined) {
                        // The vertex array object the vbo belongs to
                        this.vao = vao;
                        this.vaoExtension = gl.getExtension("OES_vertex_array_object");
                    }

                    this.size = size;
                    this.mode = mode;
                    this.bufferType = bufferType;
                    this.dataType = dataType;

                    // The underlying VBO handle
                    this.vbo = gl.createBuffer();

                    this.data = null;

                    this.attribLocation = null;

                    this.updateData(data);
                }

                GLBuffer.prototype.bind = function bind() {
                    var needsAttribues = this.data && this.data.length !== 0 && this.bufferType !== GL.ELEMENT_ARRAY_BUFFER;

                    if (needsAttribues) {
                        this.gl.enableVertexAttribArray(this.attribLocation);
                    }

                    this.gl.bindBuffer(this.bufferType, this.vbo);

                    if (needsAttribues) {
                        // Why 4??
                        this.gl.vertexAttribPointer(this.attribLocation, this.size, this.dataType, false, 4 * this.size, 0);
                    }
                };

                /**
                 * Execute a function inside the VAO state, with this buffer bound.
                 * @param {Function} fn
                 * @private
                 */

                GLBuffer.prototype._executeBound = function _executeBound(fn) {
                    if (this.vao) this.vaoExtension.bindVertexArrayOES(this.vao);

                    this.gl.bindBuffer(this.bufferType, this.vbo);
                    fn();

                    if (this.vao) this.vaoExtension.bindVertexArrayOES(null);
                };

                /**
                 * Updates the objects bound data and uploads it to the GPU.
                 */

                GLBuffer.prototype.updateData = function updateData(data) {
                    var _this = this;

                    // The currently bound underlying typed array
                    this.data = data;

                    this._executeBound(function () {
                        _this.gl.bufferData(_this.bufferType, _this.data, _this.mode);
                    });
                };

                GLBuffer.prototype.updateSubData = function updateSubData(subData, offset) {
                    var _this2 = this;

                    this.data.set(subData, offset);

                    this._executeBound(function () {
                        _this2.gl.bufferSubData(_this2.bufferType, subData, _this2.mode);
                    });
                };

                /**
                 * Bind this buffer to an attribute location in a shader program.
                 */

                GLBuffer.prototype.setAttribLocation = function setAttribLocation(location, program) {
                    var _this3 = this;

                    if (program.gl !== this.gl) {
                        console.error("Couldn't set attribute location: the program's WebGL context is not the same as the buffer's!");
                    }

                    var loc = program.getAttribLocation(location);
                    if (loc === -1) {
                        console.error("Couldn't bind buffer to location: \"" + location + "\"");
                    }

                    this._executeBound(function () {
                        _this3.gl.vertexAttribPointer(loc, _this3.size, _this3.dataType, false, 0, 0);
                        _this3.gl.enableVertexAttribArray(loc);
                    });

                    this.attribLocation = loc;
                };

                GLBuffer.prototype.destroy = function destroy() {
                    var _this4 = this;

                    this._executeBound(function () {
                        _this4.gl.deleteBuffer(_this4.vbo);
                    });
                };

                return GLBuffer;
            })();

            _export("default", GLBuffer);
        }
    };
});
System.register('lib/extra/ajax', ['npm:babel-runtime@5.4.3/core-js/promise'], function (_export) {
    var _Promise;

    function getString(url) {
        return ajax(url);
    }

    function getJson(url) {
        return ajax(url, { responseType: 'json' });
    }

    function getArrayBuffer(url) {
        return ajax(url, { responseType: 'arraybuffer' });
    }

    function ajax(url) {
        var _ref = arguments[1] === undefined ? {} : arguments[1];

        var _ref$responseType = _ref.responseType;
        var responseType = _ref$responseType === undefined ? 'text' : _ref$responseType;

        var xhr = new XMLHttpRequest();
        return new _Promise(function (resolve, reject) {
            xhr.open('GET', url);
            xhr.responseType = responseType;
            xhr.onload = function () {
                if (xhr.status == 200) {
                    resolve(xhr.response);
                } else {
                    reject(new Error(xhr.statusText));
                }
            };
            xhr.onerror = function () {
                reject(new Error('Network Error'));
            };
            xhr.send();
        });
    }

    return {
        setters: [function (_npmBabelRuntime543CoreJsPromise) {
            _Promise = _npmBabelRuntime543CoreJsPromise['default'];
        }],
        execute: function () {
            'use strict';

            _export('getString', getString);

            _export('getJson', getJson);

            _export('getArrayBuffer', getArrayBuffer);

            _export('ajax', ajax);
        }
    };
});
System.register("lib/extra/functional", ["npm:babel-runtime@5.4.3/helpers/bind"], function (_export) {
  var _bind, construct, delegate;

  return {
    setters: [function (_npmBabelRuntime543HelpersBind) {
      _bind = _npmBabelRuntime543HelpersBind["default"];
    }],
    execute: function () {
      /**
       * Takes a type and returns a function that constructs a new object of that type.
       */
      "use strict";

      construct = function construct(Type) {
        return function () {
          for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
          }

          return new (_bind.apply(Type, [null].concat(args)))();
        };
      };

      _export("construct", construct);

      /**
       *
       */

      delegate = function delegate(fn) {
        return function () {
          for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
            args[_key2] = arguments[_key2];
          }

          return fn.apply(undefined, args).apply(undefined, args);
        };
      };

      _export("delegate", delegate);
    }
  };
});
System.register('lib/workers/worker-pool', ['npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/map', 'npm:babel-runtime@5.4.3/core-js/promise', 'npm:babel-runtime@5.4.3/core-js/get-iterator', 'npm:babel-runtime@5.4.3/core-js/object/keys'], function (_export) {
    var _classCallCheck, _Map, _Promise, _getIterator, _Object$keys, workerCount, taskCount, WorkerPool;

    return {
        setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsMap) {
            _Map = _npmBabelRuntime543CoreJsMap['default'];
        }, function (_npmBabelRuntime543CoreJsPromise) {
            _Promise = _npmBabelRuntime543CoreJsPromise['default'];
        }, function (_npmBabelRuntime543CoreJsGetIterator) {
            _getIterator = _npmBabelRuntime543CoreJsGetIterator['default'];
        }, function (_npmBabelRuntime543CoreJsObjectKeys) {
            _Object$keys = _npmBabelRuntime543CoreJsObjectKeys['default'];
        }],
        execute: function () {
            'use strict';

            workerCount = 0;
            taskCount = 0;

            /**
             * A wrapper around Web Workers;
             * Passes messages to the first available worker, or creates a new one.
             * Kills workers not used for a certain time.
             */

            WorkerPool = (function () {
                function WorkerPool(sourceURL) {
                    var _ref3 = arguments[1] === undefined ? {} : arguments[1];

                    var _ref3$poolSize = _ref3.poolSize;
                    var poolSize = _ref3$poolSize === undefined ? 2 : _ref3$poolSize;
                    var _ref3$spawnLazily = _ref3.spawnLazily;
                    var spawnLazily = _ref3$spawnLazily === undefined ? true : _ref3$spawnLazily;
                    var _ref3$timeout = _ref3.timeout;
                    var timeout = _ref3$timeout === undefined ? 5 : _ref3$timeout;

                    _classCallCheck(this, WorkerPool);

                    this._workerState = new _Map();
                    this._timeout = timeout;
                    this._sourceURL = sourceURL;

                    this.poolSize = poolSize;

                    this._completers = new _Map();
                    this._taskQueue = [];

                    if (!spawnLazily) {
                        for (var i = 0; i < poolSize; ++i) {
                            this.spawnWorker();
                        }
                    }
                }

                WorkerPool.prototype._grabWork = function _grabWork(worker) {
                    var state = this._workerState.get(worker);
                    window.clearTimeout(state.timeout);
                    state.ready = false;

                    var _taskQueue$shift = this._taskQueue.shift();

                    var id = _taskQueue$shift.id;
                    var message = _taskQueue$shift.message;
                    var transfers = _taskQueue$shift.transfers;

                    //console.log(`Started work #${id} on worker #${state.id}`);
                    worker.postMessage({ id: id, message: message }, transfers);
                };

                WorkerPool.prototype.spawnWorker = function spawnWorker() {
                    var _this = this;

                    // If we are below the pool size limit
                    if (this._workerState.size < this.poolSize) {
                        var _ret = (function () {
                            var worker = new Worker(_this._sourceURL);
                            var that = _this;

                            var onMessage = function onMessage(e) {
                                var _e$data = e.data;
                                var id = _e$data.id;
                                var message = _e$data.message;

                                var state = that._workerState.get(worker);

                                var _that$_completers$get = that._completers.get(id);

                                var resolve = _that$_completers$get.resolve;
                                var reject = _that$_completers$get.reject;

                                resolve(message);
                                that._completers['delete'](id);
                                state.ready = true;
                                state.timeout = createTimeout();
                                if (that._taskQueue.length !== 0) {
                                    that._grabWork(worker);
                                }
                            };

                            var createTimeout = function createTimeout() {
                                return window.setTimeout(function () {
                                    that._workerState['delete'](worker);
                                    worker.removeEventListener('message', onMessage, false);
                                    worker.terminate();
                                }, 1000 * that._timeout);
                            };

                            worker.addEventListener('message', onMessage, false);

                            _this._workerState.set(worker, {
                                ready: true,
                                timeout: createTimeout(),
                                id: ++workerCount
                            });

                            return {
                                v: worker
                            };
                        })();

                        if (typeof _ret === 'object') return _ret.v;
                    }
                };

                /**
                 * Schedule work to run in the pool.
                 * Each worker is passed a message of the form { id, message }, and must respond similarly.
                 * The promise return the sent by the worker.
                 */

                WorkerPool.prototype.run = function run(message) {
                    var _this2 = this;

                    var _ref4 = arguments[1] === undefined ? {} : arguments[1];

                    var transfers = _ref4.transfers;

                    var id = ++taskCount;
                    return new _Promise(function (resolve, reject) {
                        _this2._completers.set(id, { resolve: resolve, reject: reject });
                        _this2._taskQueue.push({ id: id, message: message, transfers: transfers });

                        var worker = undefined;

                        // Find an available worker
                        for (var _iterator = _this2._workerState.entries(), _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _getIterator(_iterator);;) {
                            var _ref;

                            if (_isArray) {
                                if (_i >= _iterator.length) break;
                                _ref = _iterator[_i++];
                            } else {
                                _i = _iterator.next();
                                if (_i.done) break;
                                _ref = _i.value;
                            }

                            var w = _ref[0];
                            var state = _ref[1];

                            if (state.ready) {
                                worker = w;
                                break;
                            }
                        }

                        // ...or spawn a new one if none is found
                        if (worker === undefined) {
                            worker = _this2.spawnWorker();
                        }

                        // It may still be undefined if pool is full, in which case work will start as soon as one finishes
                        if (worker !== undefined) {
                            _this2._grabWork(worker);
                        }
                    });
                };

                /**
                 * Creates a WorkerPool by stringifying a function taking a resolve callback.
                 */

                WorkerPool.fromFunction = function fromFunction(fn) {
                    var dependencies = arguments[1] === undefined ? [] : arguments[1];
                    var options = arguments[2] === undefined ? {} : arguments[2];

                    var variables = {
                        'location': window.location
                    };

                    // Magic, magic, magic
                    for (var i = 0; i < dependencies.length; ++i) {
                        switch (typeof dependencies[i]) {
                            case 'function':
                                dependencies[i] = dependencies[i].toString();
                                break;
                            case 'object':
                                for (var _iterator2 = _Object$keys(dependencies[i]), _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _getIterator(_iterator2);;) {
                                    var _ref2;

                                    if (_isArray2) {
                                        if (_i2 >= _iterator2.length) break;
                                        _ref2 = _iterator2[_i2++];
                                    } else {
                                        _i2 = _iterator2.next();
                                        if (_i2.done) break;
                                        _ref2 = _i2.value;
                                    }

                                    var key = _ref2;

                                    variables[key] = dependencies[i][key];
                                }}
                    }

                    // Hogwarts next
                    var magic = _Object$keys(variables).map(function (key) {
                        return 'var ' + key + ' = ' + JSON.stringify(variables[key]) + ';';
                    });

                    // TODO: rejection handler
                    var worker = 'self.onmessage = function(event) {\n                (' + fn.toString() + ')(event.data.message, function resolve(message, transfers) {\n                    self.postMessage({ id: event.data.id, message: message }, transfers);\n                });\n            };';

                    var blob = new Blob([[].concat(magic, dependencies, [worker]).join(';\n')], { type: 'application/javascript' });
                    var url = window.URL.createObjectURL(blob);
                    return new WorkerPool(url, options);
                };

                return WorkerPool;
            })();

            _export('default', WorkerPool);
        }
    };
});
System.register('lib/extra/errors', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/create-class', 'npm:babel-runtime@5.4.3/helpers/class-call-check'], function (_export) {
    var _inherits, _createClass, _classCallCheck, UnimplementedMethodError;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersCreateClass) {
            _createClass = _npmBabelRuntime543HelpersCreateClass['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }],
        execute: function () {
            'use strict';

            UnimplementedMethodError = (function (_Error) {
                function UnimplementedMethodError() {
                    var message = arguments[0] === undefined ? 'Method not implemented!' : arguments[0];

                    _classCallCheck(this, UnimplementedMethodError);

                    _Error.call(this, message);
                }

                _inherits(UnimplementedMethodError, _Error);

                _createClass(UnimplementedMethodError, [{
                    key: 'name',
                    get: function () {
                        return 'UnimplementedMethod';
                    }
                }]);

                return UnimplementedMethodError;
            })(Error);

            _export('UnimplementedMethodError', UnimplementedMethodError);
        }
    };
});
System.register('lib/extra/atlas', ['npm:babel-runtime@5.4.3/helpers/create-class', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/math/log2', 'npm:babel-runtime@5.4.3/core-js/get-iterator', 'npm:babel-runtime@5.4.3/regenerator', 'npm:babel-runtime@5.4.3/core-js/symbol/iterator'], function (_export) {
    var _createClass, _classCallCheck, _Math$log2, _getIterator, _regeneratorRuntime, _Symbol$iterator, Atlas, Region;

    return {
        setters: [function (_npmBabelRuntime543HelpersCreateClass) {
            _createClass = _npmBabelRuntime543HelpersCreateClass['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsMathLog2) {
            _Math$log2 = _npmBabelRuntime543CoreJsMathLog2['default'];
        }, function (_npmBabelRuntime543CoreJsGetIterator) {
            _getIterator = _npmBabelRuntime543CoreJsGetIterator['default'];
        }, function (_npmBabelRuntime543Regenerator) {
            _regeneratorRuntime = _npmBabelRuntime543Regenerator['default'];
        }, function (_npmBabelRuntime543CoreJsSymbolIterator) {
            _Symbol$iterator = _npmBabelRuntime543CoreJsSymbolIterator['default'];
        }],
        execute: function () {
            'use strict';

            Atlas = (function () {
                function Atlas(_ref5) {
                    var _ref5$maxSize = _ref5.maxSize;
                    var maxSize = _ref5$maxSize === undefined ? 10 : _ref5$maxSize;
                    var _ref5$initialSize = _ref5.initialSize;
                    var initialSize = _ref5$initialSize === undefined ? 0 : _ref5$initialSize;

                    _classCallCheck(this, Atlas);

                    this.regions = [new Region(0, 0, 1 << initialSize, 1 << initialSize)];

                    // Powers of 2
                    this.maxSize = maxSize;
                }

                Atlas.imageComparator = function imageComparator(a, b) {
                    return Atlas.getImageSize(b) - Atlas.getImageSize(a);
                };

                Atlas.getImageSize = function getImageSize(image) {
                    return Math.max(image.width, image.height);
                };

                Atlas.getFittingSize = function getFittingSize(image) {
                    return Math.ceil(_Math$log2(Atlas.getImageSize(image)));
                };

                // Needs to signal what subregions changed, in what major region
                // Either it inserts successfully, returning the region
                // Or resets the entire state

                Atlas.prototype.insert = function insert(image) {
                    // Try insert into each available region

                    if (Atlas.getFittingSize(image) > this.maxSize) {
                        return [Atlas.FAILED, 'Image size is too large!'];
                    }

                    var subregion = undefined;
                    for (var i = 0, len = this.regions.length; i < len; ++i) {
                        subregion = this.regions[i].insert(image);
                        if (subregion) {
                            return [Atlas.SUCCESS, i, subregion];
                        }
                    }

                    var images = [image];
                    for (var _iterator = this.regions, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _getIterator(_iterator);;) {
                        var _ref;

                        if (_isArray) {
                            if (_i >= _iterator.length) break;
                            _ref = _iterator[_i++];
                        } else {
                            _i = _iterator.next();
                            if (_i.done) break;
                            _ref = _i.value;
                        }

                        var region = _ref;

                        for (var _iterator2 = region.images(), _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _getIterator(_iterator2);;) {
                            var _ref2;

                            if (_isArray2) {
                                if (_i2 >= _iterator2.length) break;
                                _ref2 = _iterator2[_i2++];
                            } else {
                                _i2 = _iterator2.next();
                                if (_i2.done) break;
                                _ref2 = _i2.value;
                            }

                            var img = _ref2;

                            images.push(img);
                        }
                    }
                    images.sort(Atlas.imageComparator);

                    var size = Atlas.getFittingSize(images[0]);

                    this.regions.length = 1;

                    loop: while (true) {

                        // Reset all regions except last one to max size
                        for (var i = 0; i < this.regions.length - 1; ++i) {
                            this.regions[i] = new Region(0, 0, 1 << this.maxSize, 1 << this.maxSize);
                        }
                        // Reset last region to current size
                        this.regions[this.regions.length - 1] = new Region(0, 0, 1 << size, 1 << size);

                        var currentRegion = 0;

                        var region = this.regions[currentRegion];

                        // Try to insert all images
                        for (var _iterator3 = images, _isArray3 = Array.isArray(_iterator3), _i3 = 0, _iterator3 = _isArray3 ? _iterator3 : _getIterator(_iterator3);;) {
                            var _ref3;

                            if (_isArray3) {
                                if (_i3 >= _iterator3.length) break;
                                _ref3 = _iterator3[_i3++];
                            } else {
                                _i3 = _iterator3.next();
                                if (_i3.done) break;
                                _ref3 = _i3.value;
                            }

                            var img = _ref3;

                            // Check if insertion failed
                            if (!region.insert(img)) {
                                // Increase size of last region
                                size++;

                                if (size <= this.maxSize) {
                                    // Try inserting everything again
                                    continue loop;
                                } else {
                                    // Select next region
                                    region = this.regions[++currentRegion];

                                    if (!region) {
                                        size = Atlas.getFittingSize(img);
                                        region = this.regions[currentRegion] = new Region(0, 0, 1 << size, 1 << size);
                                    }

                                    region.insert(img);
                                }
                            }
                        }

                        // All insertions successful
                        break;
                    }

                    return [Atlas.RESET];
                };

                _createClass(Atlas, null, [{
                    key: 'FAILED',
                    value: 0,
                    enumerable: true
                }, {
                    key: 'SUCCESS',
                    value: 1,
                    enumerable: true
                }, {
                    key: 'RESET',
                    value: 2,
                    enumerable: true
                }]);

                return Atlas;
            })();

            _export('Atlas', Atlas);

            Region = (function () {
                function Region() {
                    var left = arguments[0] === undefined ? 0 : arguments[0];
                    var top = arguments[1] === undefined ? 0 : arguments[1];
                    var right = arguments[2] === undefined ? 0 : arguments[2];
                    var bottom = arguments[3] === undefined ? 0 : arguments[3];

                    _classCallCheck(this, Region);

                    this.left = left;
                    this.top = top;
                    this.right = right;
                    this.bottom = bottom;

                    this.image = null;

                    this.downRegion = null;
                    this.rightRegion = null;
                }

                Region.prototype.toString = function toString() {
                    return '' + this.constructor.name + '(' + this.left + ', ' + this.top + ', ' + this.right + ', ' + this.bottom + ')';
                };

                Region.prototype.images = _regeneratorRuntime.mark(function images() {
                    var _iterator4, _isArray4, _i4, _ref4, region;

                    return _regeneratorRuntime.wrap(function images$(context$2$0) {
                        while (1) switch (context$2$0.prev = context$2$0.next) {
                            case 0:
                                _iterator4 = this, _isArray4 = Array.isArray(_iterator4), _i4 = 0, _iterator4 = _isArray4 ? _iterator4 : _getIterator(_iterator4);

                            case 1:
                                if (!_isArray4) {
                                    context$2$0.next = 7;
                                    break;
                                }

                                if (!(_i4 >= _iterator4.length)) {
                                    context$2$0.next = 4;
                                    break;
                                }

                                return context$2$0.abrupt('break', 16);

                            case 4:
                                _ref4 = _iterator4[_i4++];
                                context$2$0.next = 11;
                                break;

                            case 7:
                                _i4 = _iterator4.next();

                                if (!_i4.done) {
                                    context$2$0.next = 10;
                                    break;
                                }

                                return context$2$0.abrupt('break', 16);

                            case 10:
                                _ref4 = _i4.value;

                            case 11:
                                region = _ref4;
                                context$2$0.next = 14;
                                return region.image;

                            case 14:
                                context$2$0.next = 1;
                                break;

                            case 16:
                            case 'end':
                                return context$2$0.stop();
                        }
                    }, images, this);
                });
                Region.prototype[_Symbol$iterator] = _regeneratorRuntime.mark(function callee$1$0() {
                    return _regeneratorRuntime.wrap(function callee$1$0$(context$2$0) {
                        while (1) switch (context$2$0.prev = context$2$0.next) {
                            case 0:
                                if (!this.isFilled) {
                                    context$2$0.next = 5;
                                    break;
                                }

                                context$2$0.next = 3;
                                return this;

                            case 3:
                                return context$2$0.delegateYield(this.downRegion, 't3', 4);

                            case 4:
                                return context$2$0.delegateYield(this.rightRegion, 't4', 5);

                            case 5:
                            case 'end':
                                return context$2$0.stop();
                        }
                    }, callee$1$0, this);
                });

                /**
                 * Recursively subdivide into smaller regions.
                 * Returns the subregion if insertion was successful, otherwise undefined.
                 */

                Region.prototype.insert = function insert(image /*: { width: number, height: number } */) {
                    // region is filled, search deeper for space
                    if (this.isFilled) {
                        return this.image === image ? this : this.downRegion.insert(image) || this.rightRegion.insert(image);
                    }

                    // doesn't fit
                    if (image.height > this.outerHeight || image.width > this.outerWidth) {
                        return undefined;
                    }

                    // success, store image and split
                    this.image = image;

                    var dw = this.outerWidth - this.innerWidth; // Horizontal available space
                    var dh = this.outerHeight - this.innerHeight; // Vertical available space

                    // Split in the direction of most available space
                    if (dw > dh) {
                        this.downRegion = new Region(this.left, this.top + this.innerHeight, this.right, this.bottom);
                        this.rightRegion = new Region(this.left + this.innerWidth, this.top, this.right, this.top + this.innerHeight);
                    } else {
                        this.downRegion = new Region(this.left, this.top + this.innerHeight, this.left + this.innerWidth, this.bottom);
                        this.rightRegion = new Region(this.left + this.innerWidth, this.top, this.right, this.bottom);
                    }

                    return this;
                };

                _createClass(Region, [{
                    key: 'outerWidth',
                    get: function () {
                        return this.right - this.left;
                    }
                }, {
                    key: 'outerHeight',
                    get: function () {
                        return this.bottom - this.top;
                    }
                }, {
                    key: 'innerWidth',
                    get: function () {
                        return this.image.width;
                    }
                }, {
                    key: 'innerHeight',
                    get: function () {
                        return this.image.height;
                    }
                }, {
                    key: 'isFilled',
                    get: function () {
                        return this.image !== null;
                    }
                }]);

                return Region;
            })();

            _export('Region', Region);
        }
    };
});
System.register('lib/extra/color', ['github:toji/gl-matrix@master'], function (_export) {
    'use strict';

    var glm, vec3;

    _export('convertColorToVector', convertColorToVector);

    function convertColorToVector(color) {
        var colorVector = arguments[1] === undefined ? vec3.create() : arguments[1];

        if (typeof color === 'number') {
            // Hexadecimal 24-bit color
            vec3.set(colorVector, ((color & 16711680) >> 16) / 255, // Red
            ((color & 65280) >> 8) / 255, // Green
            (color & 255) / 255); // Blue
        } else if ('length' in color) {
            // Vector of floats in range [0,1]
            vec3.copy(colorVector, color);
        } else {}

        return colorVector;
    }

    return {
        setters: [function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }],
        execute: function () {
            vec3 = glm.vec3;
        }
    };
});

// Unknown color type!
System.register('lib/light/pointlight', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/helpers/object-without-properties', 'npm:babel-runtime@5.4.3/core-js/object/freeze', 'lib/extra/functional', 'lib/light/base', 'npm:memoizee@0.3.8'], function (_export) {
    var _inherits, _classCallCheck, _objectWithoutProperties, _Object$freeze, construct, Light, LightRenderer, memoize, PointLight, PointLightRenderer;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543HelpersObjectWithoutProperties) {
            _objectWithoutProperties = _npmBabelRuntime543HelpersObjectWithoutProperties['default'];
        }, function (_npmBabelRuntime543CoreJsObjectFreeze) {
            _Object$freeze = _npmBabelRuntime543CoreJsObjectFreeze['default'];
        }, function (_libExtraFunctional) {
            construct = _libExtraFunctional.construct;
        }, function (_libLightBase) {
            Light = _libLightBase.Light;
            LightRenderer = _libLightBase.LightRenderer;
        }, function (_npmMemoizee038) {
            memoize = _npmMemoizee038['default'];
        }],
        execute: function () {
            'use strict';

            PointLight = (function (_Light) {
                function PointLight() {
                    var _ref = arguments[0] === undefined ? {} : arguments[0];

                    var _ref$constant = _ref.constant;
                    var constant = _ref$constant === undefined ? 1 : _ref$constant;
                    var _ref$linear = _ref.linear;
                    var linear = _ref$linear === undefined ? 0.7 : _ref$linear;
                    var _ref$quadratic = _ref.quadratic;
                    var quadratic = _ref$quadratic === undefined ? 1.8 : _ref$quadratic;

                    var options = _objectWithoutProperties(_ref, ['constant', 'linear', 'quadratic']);

                    _classCallCheck(this, PointLight);

                    _Light.call(this, 'pointlight', PointLightRenderer, options);

                    this.constant = constant;
                    this.linear = linear;
                    this.quadratic = quadratic;

                    //Object.seal(this);
                }

                _inherits(PointLight, _Light);

                return PointLight;
            })(Light);

            _export('default', PointLight);

            PointLightRenderer = (function (_LightRenderer) {
                function PointLightRenderer(light, gl) {
                    _classCallCheck(this, PointLightRenderer);

                    _LightRenderer.call(this, light, gl);
                    //Object.freeze(this);
                }

                _inherits(PointLightRenderer, _LightRenderer);

                PointLightRenderer.prototype.getLocations = function getLocations(program) {
                    return _Object$freeze({
                        position: program.getUniformLocation('pointLights[' + this.id + '].position'),
                        diffuse: program.getUniformLocation('pointLights[' + this.id + '].diffuse'),
                        specular: program.getUniformLocation('pointLights[' + this.id + '].specular'),
                        constant: program.getUniformLocation('pointLights[' + this.id + '].constant'),
                        linear: program.getUniformLocation('pointLights[' + this.id + '].linear'),
                        quadratic: program.getUniformLocation('pointLights[' + this.id + '].quadratic')
                    });
                };

                PointLightRenderer.prototype.render = function render(program) {
                    var gl = this.gl;
                    var light = this.light;
                    var locations = this.getLocations(program);

                    gl.uniform3fv(locations.position, light.worldPosition);
                    gl.uniform3fv(locations.diffuse, light._diffuseVector);
                    gl.uniform3fv(locations.specular, light._specularVector);

                    gl.uniform1f(locations.constant, light.constant);
                    gl.uniform1f(locations.linear, light.linear);
                    gl.uniform1f(locations.quadratic, light.quadratic);
                };

                return PointLightRenderer;
            })(LightRenderer);
        }
    };
});
System.register('lib/light/spotlight', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/helpers/object-without-properties', 'npm:babel-runtime@5.4.3/core-js/object/freeze', 'github:toji/gl-matrix@master', 'lib/extra/functional', 'lib/light/base', 'npm:memoizee@0.3.8'], function (_export) {
    var _inherits, _classCallCheck, _objectWithoutProperties, _Object$freeze, glm, construct, Light, LightRenderer, memoize, vec3, deg2rad, SpotLight, SpotLightRenderer;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543HelpersObjectWithoutProperties) {
            _objectWithoutProperties = _npmBabelRuntime543HelpersObjectWithoutProperties['default'];
        }, function (_npmBabelRuntime543CoreJsObjectFreeze) {
            _Object$freeze = _npmBabelRuntime543CoreJsObjectFreeze['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }, function (_libExtraFunctional) {
            construct = _libExtraFunctional.construct;
        }, function (_libLightBase) {
            Light = _libLightBase.Light;
            LightRenderer = _libLightBase.LightRenderer;
        }, function (_npmMemoizee038) {
            memoize = _npmMemoizee038['default'];
        }],
        execute: function () {
            'use strict';

            vec3 = glm.vec3;
            deg2rad = Math.PI / 180;

            SpotLight = (function (_Light) {
                function SpotLight() {
                    var _ref = arguments[0] === undefined ? {} : arguments[0];

                    var _ref$constant = _ref.constant;
                    var constant = _ref$constant === undefined ? 1 : _ref$constant;
                    var _ref$linear = _ref.linear;
                    var linear = _ref$linear === undefined ? 0.7 : _ref$linear;
                    var _ref$quadratic = _ref.quadratic;
                    var quadratic = _ref$quadratic === undefined ? 1.8 : _ref$quadratic;
                    var _ref$cutoff = _ref.cutoff;
                    var cutoff = _ref$cutoff === undefined ? 40 : _ref$cutoff;
                    var _ref$outerCutoff = _ref.outerCutoff;
                    var outerCutoff = _ref$outerCutoff === undefined ? 35 : _ref$outerCutoff;

                    var options = _objectWithoutProperties(_ref, ['constant', 'linear', 'quadratic', 'cutoff', 'outerCutoff']);

                    _classCallCheck(this, SpotLight);

                    _Light.call(this, 'spotlight', SpotLightRenderer, options);

                    this.constant = constant;
                    this.linear = linear;
                    this.quadratic = quadratic;
                    this.cutoff = cutoff;
                    this.outerCutoff = outerCutoff;

                    this.direction = vec3.create();
                    this.worldDirection = vec3.create();
                }

                _inherits(SpotLight, _Light);

                SpotLight.prototype.recalculate = function recalculate(existingNodes) {
                    var dirty = _Light.prototype.recalculate.call(this, existingNodes);

                    var direction = this.direction;
                    var orientation = this.orientation;

                    if (dirty) {
                        var x = orientation[0],
                            y = orientation[1],
                            z = orientation[2],
                            w = orientation[3];

                        direction[0] = -2 * (x * z + y * w);
                        direction[1] = 2 * (x * w - y * z);
                        direction[2] = x * x + y * y - (z * z + w * w);

                        if (this.parent) {
                            vec3.transformMat3(this.worldDirection, this.direction, this.parent.normalMatrix);
                        } else {
                            vec3.copy(this.worldDirection, this.direction);
                        }
                    }

                    return dirty;
                };

                return SpotLight;
            })(Light);

            _export('default', SpotLight);

            SpotLightRenderer = (function (_LightRenderer) {
                function SpotLightRenderer(light, gl) {
                    _classCallCheck(this, SpotLightRenderer);

                    _LightRenderer.call(this, light, gl);
                    //Object.freeze(this);
                }

                _inherits(SpotLightRenderer, _LightRenderer);

                SpotLightRenderer.prototype.getLocations = function getLocations(program) {
                    return _Object$freeze({
                        position: program.getUniformLocation('spotLights[' + this.id + '].position'),
                        direction: program.getUniformLocation('spotLights[' + this.id + '].direction'),
                        diffuse: program.getUniformLocation('spotLights[' + this.id + '].diffuse'),
                        specular: program.getUniformLocation('spotLights[' + this.id + '].specular'),
                        constant: program.getUniformLocation('spotLights[' + this.id + '].constant'),
                        linear: program.getUniformLocation('spotLights[' + this.id + '].linear'),
                        quadratic: program.getUniformLocation('spotLights[' + this.id + '].quadratic'),
                        cutoff: program.getUniformLocation('spotLights[' + this.id + '].cutoff'),
                        outerCutoff: program.getUniformLocation('spotLights[' + this.id + '].outerCutoff')
                    });
                };

                SpotLightRenderer.prototype.render = function render(program) {
                    var gl = this.gl;
                    var light = this.light;
                    var locations = this.getLocations(program);

                    gl.uniform3fv(locations.position, light.worldPosition);
                    gl.uniform3fv(locations.direction, light.worldDirection);

                    gl.uniform3fv(locations.diffuse, light._diffuseVector);
                    gl.uniform3fv(locations.specular, light._specularVector);

                    gl.uniform1f(locations.constant, light.constant);
                    gl.uniform1f(locations.linear, light.linear);
                    gl.uniform1f(locations.quadratic, light.quadratic);

                    gl.uniform1f(locations.cutoff, light.cutoff * deg2rad);
                    gl.uniform1f(locations.outerCutoff, light.outerCutoff * deg2rad);
                };

                return SpotLightRenderer;
            })(LightRenderer);
        }
    };
});
System.register('lib/scene/group', ['npm:babel-runtime@5.4.3/helpers/bind', 'npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/array/from', 'npm:babel-runtime@5.4.3/core-js/symbol/iterator', 'npm:babel-runtime@5.4.3/regenerator', 'npm:babel-runtime@5.4.3/core-js/get-iterator', 'lib/scene/base', 'lib/scene/model', 'github:toji/gl-matrix@master'], function (_export) {
    var _bind, _inherits, _classCallCheck, _Array$from, _Symbol$iterator, _regeneratorRuntime, _getIterator, Scene, Model, glm, vec3, points, isDirty, Group, SplitGroup;

    function group() {
        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
        }

        return new (_bind.apply(Group, [null].concat(args)))();
    }

    return {
        setters: [function (_npmBabelRuntime543HelpersBind) {
            _bind = _npmBabelRuntime543HelpersBind['default'];
        }, function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsArrayFrom) {
            _Array$from = _npmBabelRuntime543CoreJsArrayFrom['default'];
        }, function (_npmBabelRuntime543CoreJsSymbolIterator) {
            _Symbol$iterator = _npmBabelRuntime543CoreJsSymbolIterator['default'];
        }, function (_npmBabelRuntime543Regenerator) {
            _regeneratorRuntime = _npmBabelRuntime543Regenerator['default'];
        }, function (_npmBabelRuntime543CoreJsGetIterator) {
            _getIterator = _npmBabelRuntime543CoreJsGetIterator['default'];
        }, function (_libSceneBase) {
            Scene = _libSceneBase['default'];
        }, function (_libSceneModel) {
            Model = _libSceneModel['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }],
        execute: function () {
            'use strict';

            _export('group', group);

            vec3 = glm.vec3;
            points = new Float64Array(24);

            isDirty = function isDirty(node) {
                return node.dirty;
            };

            Group = (function (_Scene) {
                function Group(name) {
                    var options = arguments[1] === undefined ? {} : arguments[1];
                    var children = arguments[2] === undefined ? [] : arguments[2];

                    _classCallCheck(this, Group);

                    _Scene.call(this, name, options);

                    this.children = _Array$from(children);
                    this.splitSize = 64;

                    for (var i = 0, len = children.length; i < len; ++i) {
                        children[i].parent = this;
                    }

                    // Object.seal(this);
                }

                _inherits(Group, _Scene);

                Group.prototype.toString = function toString() {
                    var props = arguments[0] === undefined ? ['name', 'dirty'] : arguments[0];
                    var depth = arguments[1] === undefined ? 0 : arguments[1];

                    return _Scene.prototype.toString.call(this, props, depth) + this.children.map(function (child) {
                        return '\n' + child.toString(props, depth + 1);
                    }).join('');
                };

                Group.prototype.forEach = function forEach(cb) {
                    cb(this);

                    for (var i = 0, children = this.children, len = children.length; i < len; ++i) {
                        children[i].forEach(cb);
                    }
                };

                Group.prototype.recalculate = function recalculate(existingNodes) {
                    var dirtySubtree = _Scene.prototype.recalculate.call(this, existingNodes);

                    var aabb = this.aabb;
                    var children = this.children;
                    var len = this.children.length;

                    var processing = false;
                    var i = undefined,
                        child = undefined;

                    for (i = 0; i < len, child = children[i]; ++i) {
                        // If any child is processing, so is the parent
                        processing = processing || child.processing;

                        // If parent is dirty, set child to be dirty
                        child.dirty = child.dirty || dirtySubtree;

                        dirtySubtree = child.recalculate(existingNodes) || dirtySubtree;
                    }

                    if (dirtySubtree) {
                        aabb.resetIntervals();
                        for (i = 0; i < len; ++i) {
                            aabb.expandFromIntervals(children[i].aabb.intervals);
                        }
                        aabb.computePoints();
                    }

                    this.processing = processing;

                    if (!this.processing && children.length > this.splitSize) {
                        this.split();
                    }

                    return dirtySubtree;
                };

                Group.prototype.recalculateSubtreeIds = function recalculateSubtreeIds() {
                    this.subtreeIds.length = 1;
                    this.subtreeIds[0] = this.id;
                    for (var i = 0, children = this.children, len = children.length, child = undefined; i < len, child = children[i]; ++i) {
                        var _subtreeIds;

                        child.recalculateSubtreeIds();
                        (_subtreeIds = this.subtreeIds).push.apply(_subtreeIds, child.subtreeIds);
                    }
                };

                Group.prototype.add = function add(node) {
                    node.parent = this;
                    this.children.push(node);
                };

                Group.prototype.remove = function remove(node) {
                    node.parent = null;
                    this.children.splice(this.children.indexOf(node), 1);
                };

                Group.prototype[_Symbol$iterator] = _regeneratorRuntime.mark(function callee$1$0() {
                    var _iterator, _isArray, _i, _ref, child;

                    return _regeneratorRuntime.wrap(function callee$1$0$(context$2$0) {
                        while (1) switch (context$2$0.prev = context$2$0.next) {
                            case 0:
                                context$2$0.next = 2;
                                return this;

                            case 2:
                                _iterator = this.children, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _getIterator(_iterator);

                            case 3:
                                if (!_isArray) {
                                    context$2$0.next = 9;
                                    break;
                                }

                                if (!(_i >= _iterator.length)) {
                                    context$2$0.next = 6;
                                    break;
                                }

                                return context$2$0.abrupt('break', 17);

                            case 6:
                                _ref = _iterator[_i++];
                                context$2$0.next = 13;
                                break;

                            case 9:
                                _i = _iterator.next();

                                if (!_i.done) {
                                    context$2$0.next = 12;
                                    break;
                                }

                                return context$2$0.abrupt('break', 17);

                            case 12:
                                _ref = _i.value;

                            case 13:
                                child = _ref;
                                return context$2$0.delegateYield(child, 't5', 15);

                            case 15:
                                context$2$0.next = 3;
                                break;

                            case 17:
                            case 'end':
                                return context$2$0.stop();
                        }
                    }, callee$1$0, this);
                });

                /// Split children into spatially divide subgroups

                Group.prototype.split = function split() {
                    var intervals = this.aabb.intervals;

                    var midX = (intervals[0] + intervals[1]) / 2;
                    var midY = (intervals[2] + intervals[3]) / 2;
                    var midZ = (intervals[4] + intervals[5]) / 2;

                    var octants = [[], [], [], [], [], [], [], []];

                    for (var i = 0, children = this.children, len = children.length, child = undefined; i < len, child = children[i]; ++i) {
                        var vec = child.aabb.center;
                        octants[((vec[0] < midX) << 2) + ((vec[1] < midY) << 1) + (vec[2] < midZ)].push(child);
                    }

                    var splitGroups = [];

                    for (var i = 0, len = octants.length, octant = undefined; i < len, octant = octants[i]; ++i) {
                        if (octant.length) {
                            var _group = new SplitGroup(this, {}, octant);
                            _group.parent = this;
                            splitGroups.push(_group);
                        }
                    }

                    this.children = splitGroups;
                };

                return Group;
            })(Scene);

            _export('default', Group);

            SplitGroup = (function (_Group) {
                function SplitGroup(group) {
                    var options = arguments[1] === undefined ? {} : arguments[1];
                    var children = arguments[2] === undefined ? [] : arguments[2];

                    _classCallCheck(this, SplitGroup);

                    _Group.call(this, 'split', options, children);

                    this.orientation = group.orientation;
                    this.position = group.position;
                    this.scale = group.scale;
                    this.localTransform = group.localTransform;
                    this.worldTransform = group.worldTransform;
                    this.direction = group.direction;
                    this.worldDirection = group.worldDirection;
                    this.worldPosition = group.worldPosition;
                    this.normalMatrix = group.normalMatrix;

                    this.processing = false;
                }

                _inherits(SplitGroup, _Group);

                // Only recalculate children

                SplitGroup.prototype.recalculate = function recalculate(existingNodes) {
                    var aabb = this.aabb;
                    var children = this.children;
                    var len = this.children.length;

                    var dirtySubtree = this.dirty;

                    for (var i = 0, child = undefined; i < len, child = children[i]; ++i) {
                        child.dirty = child.dirty || this.dirty;
                        dirtySubtree = child.recalculate(existingNodes) || dirtySubtree;
                    }

                    if (dirtySubtree) {
                        aabb.resetIntervals();
                        for (var i = 0; i < len; ++i) {
                            aabb.expandFromIntervals(children[i].aabb.intervals);
                        }
                        aabb.computePoints();
                    }

                    if (!this.processing && children.length > this.splitSize) {
                        this.split();
                    }

                    existingNodes.set(this.id);

                    this.dirty = false;

                    return dirtySubtree;
                };

                return SplitGroup;
            })(Group);
        }
    };
});
System.register('lib/environment/environment', ['npm:babel-runtime@5.4.3/helpers/class-call-check', 'lib/extra/color'], function (_export) {
    var _classCallCheck, convertColorToVector, GL, Environment;

    return {
        setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_libExtraColor) {
            convertColorToVector = _libExtraColor.convertColorToVector;
        }],
        execute: function () {
            'use strict';

            GL = WebGLRenderingContext;

            Environment = (function () {
                function Environment() {
                    var _ref = arguments[0] === undefined ? {} : arguments[0];

                    var _ref$ambient = _ref.ambient;
                    var ambient = _ref$ambient === undefined ? 0 : _ref$ambient;

                    _classCallCheck(this, Environment);

                    this.ambient = ambient;
                    this._ambientVector = convertColorToVector(this.ambient);
                }

                // Runs once for each instance by the renderer

                Environment.prototype.initialize = function initialize(renderer) {
                    this.gl = renderer.gl;
                    var vec = this._ambientVector;
                    this.gl.clearColor(vec[0], vec[1], vec[2], 1);
                };

                Environment.prototype.render = function render() {
                    this.gl.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
                };

                Environment.prototype.renderLast = function renderLast() {};

                return Environment;
            })();

            _export('default', Environment);
        }
    };
});
System.register('lib/extra/bitfield', ['npm:babel-runtime@5.4.3/helpers/create-class', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/array/from'], function (_export) {
    var _createClass, _classCallCheck, _Array$from, Bitfield;

    return {
        setters: [function (_npmBabelRuntime543HelpersCreateClass) {
            _createClass = _npmBabelRuntime543HelpersCreateClass['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsArrayFrom) {
            _Array$from = _npmBabelRuntime543CoreJsArrayFrom['default'];
        }],
        execute: function () {
            'use strict';

            Bitfield = (function () {
                function Bitfield() {
                    var initialSize = arguments[0] === undefined ? 8 : arguments[0];

                    var _ref = arguments[1] === undefined ? {} : arguments[1];

                    var _ref$grow = _ref.grow;
                    var grow = _ref$grow === undefined ? true : _ref$grow;

                    _classCallCheck(this, Bitfield);

                    var length = Math.ceil((initialSize + 1) / 32);
                    this._grow = grow;
                    this._buffer = new Uint32Array(length);
                    this._emptyBuffer = new Uint32Array(length);
                }

                Bitfield.prototype.toString = function toString() {
                    return _Array$from(this._buffer, function (n) {
                        var padding = '00000000000000000000000000000000';
                        var num = n.toString(2);
                        return (padding.substring(0, 32 - num.length) + num).split('').reverse().join('');
                    }).join('');
                };

                Bitfield.prototype.toArray = function toArray() {
                    var buffer = this._buffer;
                    var length = buffer.length << 5;
                    var array = [];
                    for (var i = 0; i < length; ++i) {
                        if ((buffer[i >> 5] & 1 << i % 32) !== 0) {
                            array.push(i);
                        }
                    }
                    return array;
                };

                Bitfield.prototype.toBitArray = function toBitArray() {
                    var buffer = this._buffer;
                    var length = buffer.length << 5;
                    var array = new Array(length);
                    for (var i = 0; i < length; ++i) {
                        array[i] = (buffer[i >> 5] & 1 << i % 32) !== 0;
                    }
                    return array;
                };

                Bitfield.prototype.get = function get(i) {
                    return (this._buffer[i >> 5] & 1 << i % 32) !== 0;
                };

                Bitfield.prototype.set = function set(i) {
                    var index = i >> 5;
                    if (this._grow && index >= this._buffer.length) this._resize(i);
                    this._buffer[index] |= 1 << i % 32;
                };

                Bitfield.prototype.unset = function unset(i) {
                    var index = i >> 5;
                    if (this._grow && index >= this._buffer.length) this._resize(i);

                    this._buffer[index] &= ~(1 << i % 32);
                };

                Bitfield.prototype.reset = function reset() {
                    this._buffer.set(this._emptyBuffer);
                };

                Bitfield.prototype.forEach = function forEach(cb) {
                    var buffer = this._buffer;
                    var field = undefined,
                        len = undefined,
                        i = undefined,
                        j = undefined;
                    for (i = 0, len = buffer.length; i < len; ++i) {
                        field = buffer[i];
                        for (j = 0; j < 32; ++j) {
                            if (field & 1 << j !== 0) {
                                cb((i << 5) + j);
                            }
                        }
                    }
                };

                Bitfield.prototype.diff = function diff(bitfield) {
                    var target = arguments[1] === undefined ? new Bitfield() : arguments[1];

                    var buffer = this._buffer;
                    var otherBuffer = bitfield._buffer;
                    var targetBuffer = target._buffer;

                    var size = Math.max(buffer.length, otherBuffer.length);

                    if (targetBuffer.length < size) {
                        target._resize((size << 5) - 1);
                        targetBuffer = target._buffer;
                    }

                    for (var i = 0; i < size; ++i) {
                        targetBuffer[i] = buffer[i] ^ otherBuffer[i];
                    }

                    return target;
                };

                Bitfield.prototype.union = function union(bitfield) {
                    var target = arguments[1] === undefined ? new Bitfield() : arguments[1];

                    var buffer = this._buffer;
                    var otherBuffer = bitfield._buffer;
                    var targetBuffer = target._buffer;

                    var size = Math.max(buffer.length, otherBuffer.length);

                    if (targetBuffer.length < size) {
                        target._resize((size << 5) - 1);
                        targetBuffer = target._buffer;
                    }

                    for (var i = 0; i < size; ++i) {
                        targetBuffer[i] = buffer[i] | otherBuffer[i];
                    }

                    return target;
                };

                Bitfield.prototype.intersect = function intersect(bitfield) {
                    var target = arguments[1] === undefined ? new Bitfield() : arguments[1];

                    var buffer = this._buffer;
                    var otherBuffer = bitfield._buffer;
                    var targetBuffer = target._buffer;

                    var size = Math.max(buffer.length, otherBuffer.length);

                    if (targetBuffer.length < size) {
                        target._resize((size << 5) - 1);
                        targetBuffer = target._buffer;
                    }

                    for (var i = 0; i < size; ++i) {
                        targetBuffer[i] = buffer[i] & otherBuffer[i];
                    }

                    return target;
                };

                Bitfield.prototype._resize = function _resize(i) {
                    var oldBuffer = this._buffer;
                    var newLength = Math.ceil((i + 1) / 32);
                    this._buffer = new Uint32Array(newLength);
                    this._emptyBuffer = new Uint32Array(newLength);
                    this._buffer.set(oldBuffer);
                };

                _createClass(Bitfield, [{
                    key: 'isEmpty',
                    get: function () {
                        for (var i = 0, buffer = this._buffer, len = buffer.length; i < len; ++i) {
                            if (buffer[i] !== 0) {
                                return false;
                            }
                        }
                        return true;
                    }
                }]);

                return Bitfield;
            })();

            _export('default', Bitfield);
        }
    };
});
System.register('lib/texture/cubemap', ['npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/helpers/bind', 'npm:babel-runtime@5.4.3/core-js/promise', 'npm:babel-runtime@5.4.3/core-js/math/log2', 'lib/texture/common'], function (_export) {
    var _classCallCheck, _bind, _Promise, _Math$log2, resizeImageData, getImage, MAX_SIZE, CubeMap;

    return {
        setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543HelpersBind) {
            _bind = _npmBabelRuntime543HelpersBind['default'];
        }, function (_npmBabelRuntime543CoreJsPromise) {
            _Promise = _npmBabelRuntime543CoreJsPromise['default'];
        }, function (_npmBabelRuntime543CoreJsMathLog2) {
            _Math$log2 = _npmBabelRuntime543CoreJsMathLog2['default'];
        }, function (_libTextureCommon) {
            resizeImageData = _libTextureCommon.resizeImageData;
            getImage = _libTextureCommon.getImage;
        }],
        execute: function () {
            'use strict';

            MAX_SIZE = (function () {
                var canvas = document.createElement('canvas');
                var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                return gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
            })();

            CubeMap = (function () {
                function CubeMap(right, left, top, bottom, front, back) {
                    _classCallCheck(this, CubeMap);

                    this.right = right;this.left = left;
                    this.top = top;this.bottom = bottom;
                    this.front = front;this.back = back;
                }

                CubeMap.fromFiles = function fromFiles(right, left, top, bottom, front, back, format) {
                    return _Promise.all([right, left, top, bottom, front, back].map(function (filename) {
                        return getImage(filename, format);
                    })).then(function (images) {

                        var isPowerOf2 = function isPowerOf2(x) {
                            return x != 0 && !(x & x - 1);
                        };

                        // Correct sizes if all images have identical dimensions, as a power of two smaller than MAX_SIZE
                        if (images[0].width !== images[0].height || images[0].width > MAX_SIZE || !isPowerOf2(images[0].width) || images.slice(0).some(function (image) {
                            return image.width !== images[0].width || image.height !== images[0].height;
                        })) {
                            (function () {
                                var bestSize = function bestSize(image) {
                                    return 1 << Math.floor(_Math$log2(Math.max(image.width, image.height)));
                                };
                                var largest = images.reduce(function (size, image) {
                                    return Math.max(size, bestSize(image));
                                }, 0);
                                var size = Math.min(MAX_SIZE, largest);
                                images = images.map(function (image) {
                                    return resizeImageData(image, size, size);
                                });
                            })();
                        }

                        return new (_bind.apply(CubeMap, [null].concat(images)))();
                    });
                };

                return CubeMap;
            })();

            _export('default', CubeMap);
        }
    };
});
System.register('lib/geometry/shapes', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'lib/geometry/geometry', 'github:toji/gl-matrix@master'], function (_export) {
    var _inherits, _classCallCheck, Geometry, glm, vec3, mat4, vec3buf, mat4buf, Cube, Plane;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_libGeometryGeometry) {
            Geometry = _libGeometryGeometry['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }],
        execute: function () {
            'use strict';

            vec3 = glm.vec3;
            mat4 = glm.mat4;
            vec3buf = vec3.create();
            mat4buf = mat4.create();

            /**
             * A cube of size 1x1x1
             */

            Cube = (function (_Geometry) {
                function Cube() {
                    _classCallCheck(this, Cube);

                    var points = [1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, -1, -1, -1, -1, -1, 1, -1];
                    _Geometry.call(this, {
                        vertices: points.map(function (n) {
                            return 0.5 * n;
                        }),
                        normals: points.map(function (n) {
                            return Math.sqrt(3) / 3 * n;
                        }),
                        texcoords: [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1],
                        indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 1, 9, 8, 9, 10, 11, 12, 13, 11, 13, 14, 15, 16, 2, 15, 2, 17, 15, 18, 19, 15, 19, 10]
                    });
                }

                _inherits(Cube, _Geometry);

                return Cube;
            })(Geometry);

            _export('Cube', Cube);

            /**
             * A plane of size 1x1 in the xz-plane, facing up.
             * If a texture map is used, no normals are generated, use generateNormals() manually.
             */

            Plane = (function (_Geometry2) {
                function Plane() {
                    var _ref = arguments[0] === undefined ? {} : arguments[0];

                    var _ref$size = _ref.size;
                    var size = _ref$size === undefined ? 8 : _ref$size;
                    var _ref$heightmap = _ref.heightmap;
                    var heightmap = _ref$heightmap === undefined ? null : _ref$heightmap;
                    var _ref$repeat = _ref.repeat;
                    var repeat = _ref$repeat === undefined ? false : _ref$repeat;

                    _classCallCheck(this, Plane);

                    var data = null;
                    var width = undefined,
                        height = undefined;

                    if (heightmap === null) {
                        width = size;
                        height = size;
                    } else {
                        width = heightmap.width;
                        height = heightmap.height;
                        data = heightmap.imageData.data;
                    }

                    var vertexCount = width * height;
                    var triangleCount = (width - 1) * height * 2;

                    var vertices = new Float32Array(3 * vertexCount);
                    var texcoords = new Float32Array(2 * vertexCount);
                    var indices = new Uint16Array(3 * triangleCount);

                    var x = undefined,
                        z = undefined,
                        offset = undefined;

                    for (x = 0; x < width; ++x) {
                        for (z = 0; z < height; ++z) {
                            offset = x + z * width;

                            vertices[3 * offset] = x / (width - 1) - 0.5;
                            vertices[3 * offset + 1] = data ? data[4 * offset] / 255 : 0; // Sample R-value in texture
                            vertices[3 * offset + 2] = z / (height - 1) - 0.5;

                            texcoords[2 * offset] = repeat ? x % 2 == !0 : x / width;
                            texcoords[2 * offset + 1] = repeat ? z % 2 == !0 : 1 - z / height;
                        }
                    }

                    for (x = 0; x < width - 1; ++x) {
                        for (z = 0; z < height - 1; ++z) {
                            offset = 6 * (x + z * (width - 1));

                            // Triangle 1
                            indices[offset] = x + z * width;
                            indices[offset + 1] = x + (z + 1) * width;
                            indices[offset + 2] = x + 1 + z * width;

                            // Triangle 2
                            indices[offset + 3] = x + 1 + z * width;
                            indices[offset + 4] = x + (z + 1) * width;
                            indices[offset + 5] = x + 1 + (z + 1) * width;
                        }
                    }

                    var config = { vertices: vertices, texcoords: texcoords, indices: indices };

                    if (!data) {
                        var normals = new Float32Array(vertices.length);
                        // Set all Y-values to 1
                        for (var _offset = 1, len = vertices.length; _offset < len; _offset += 3) {
                            normals[_offset] = 1;
                        }
                        config.normals = normals;
                    }

                    _Geometry2.call(this, config);

                    this.heightmap = heightmap;
                }

                _inherits(Plane, _Geometry2);

                // UGLY, ugly piece of S**T

                Plane.prototype.getHeightAtWorldPosition = function getHeightAtWorldPosition(camera, model) {
                    var _this = this;

                    var localPosition = vec3.transformMat4(vec3buf, camera.worldPosition, mat4.invert(mat4buf, model.worldTransform));

                    if (this.heightmap === null) {
                        localPosition[1] = 0;
                    } else {
                        (function () {

                            var clamp = function clamp(x, min, max) {
                                return Math.min(Math.max(x, min), max);
                            };

                            var width = _this.heightmap.imageData.width;
                            var height = _this.heightmap.imageData.height;

                            var x = clamp(width * (localPosition[0] + 0.5), 0, width - 1);
                            var z = clamp(height * (localPosition[2] + 0.5), 0, height - 1);

                            var x_left = Math.floor(x);
                            var x_right = Math.ceil(x);
                            var z_top = Math.floor(z);
                            var z_down = Math.ceil(z);

                            var sample = function sample(x, z) {
                                return _this.heightmap.imageData.data[4 * (x + z * width)] / 256;
                            };

                            var lerp = function lerp(a, b, t) {
                                return a + t * (b - a);
                            };

                            localPosition[1] = lerp(sample(x_left, z_top), sample(x_right, z_top), x % 1);
                        })();
                    }

                    var worldPosition = vec3.transformMat4(vec3buf, localPosition, model.worldTransform);

                    return worldPosition[1];

                    /*
                    const cameraSpacePosition = vec3.transformMat4(vec3.create(), worldPosition, mat4.invert(mat4.create(), camera.worldTransform));
                     return cameraSpacePosition[1];
                    */
                };

                return Plane;
            })(Geometry);

            _export('Plane', Plane);
        }
    };
});
System.register('lib/camera/orthographic-camera', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'lib/camera/base', 'github:toji/gl-matrix@master'], function (_export) {
    var _inherits, _classCallCheck, Camera, glm, OrthographicCamera;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_libCameraBase) {
            Camera = _libCameraBase['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }],
        execute: function () {
            'use strict';

            OrthographicCamera = (function (_Camera) {
                function OrthographicCamera() {
                    var options = arguments[0] === undefined ? {} : arguments[0];

                    _classCallCheck(this, OrthographicCamera);

                    _Camera.call(this, options);
                    var _options$left = options.left;
                    var left = _options$left === undefined ? -1 : _options$left;
                    var _options$right = options.right;
                    var right = _options$right === undefined ? 1 : _options$right;
                    var _options$bottom = options.bottom;
                    var bottom = _options$bottom === undefined ? -1 : _options$bottom;
                    var _options$top = options.top;
                    var top = _options$top === undefined ? 1 : _options$top;
                    var _options$near = options.near;
                    var near = _options$near === undefined ? 0.1 : _options$near;
                    var _options$far = options.far;
                    var far = _options$far === undefined ? 1000 : _options$far;

                    this.left = left;
                    this.right = right;
                    this.bottom = bottom;
                    this.top = top;
                    this.near = near;
                    this.far = far;

                    // Used for dirty checking
                    this._lastLeft = this.left;
                    this._lastRight = this.right;
                    this._lastBottom = this.bottom;
                    this._lastTop = this.top;
                    this._lastNear = this.near;
                    this._lastFar = this.far;

                    // Object.seal(this);
                }

                _inherits(OrthographicCamera, _Camera);

                OrthographicCamera.prototype.recalculate = function recalculate(existingNodes) {
                    this.dirty = this.dirty || this.parent !== null && this.parent.dirty || this.left !== this._lastLeft || this.right !== this._lastRight || this.bottom !== this._lastBottom || this.top !== this._lastTop || this.near !== this._lastNear || this.far !== this._lastFar;

                    if (this.dirty) {
                        glm.mat4.ortho(this.projectionMatrix, this.left, this.right, this.bottom, this.top, this.near, this.far);

                        this._lastLeft = this.left;
                        this._lastRight = this.right;
                        this._lastBottom = this.bottom;
                        this._lastTop = this.top;
                        this._lastNear = this.near;
                        this._lastFar = this.far;
                    }

                    return _Camera.prototype.recalculate.call(this, existingNodes);
                };

                return OrthographicCamera;
            })(Camera);

            _export('default', OrthographicCamera);
        }
    };
});
System.register('lib/environment/skybox', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/promise', 'github:toji/gl-matrix@master', 'lib/environment/environment', 'lib/webgl/program', 'lib/webgl/shader', 'lib/geometry/shapes', 'lib/texture/common'], function (_export) {
    var _inherits, _classCallCheck, _Promise, glm, Environment, GLProgram, GLShader, Cube, allocateTextureUnit, mat4, GL, vertShaderSourceOLD, vertShaderSource, fragShaderSource, Skybox;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsPromise) {
            _Promise = _npmBabelRuntime543CoreJsPromise['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }, function (_libEnvironmentEnvironment) {
            Environment = _libEnvironmentEnvironment['default'];
        }, function (_libWebglProgram) {
            GLProgram = _libWebglProgram['default'];
        }, function (_libWebglShader) {
            GLShader = _libWebglShader['default'];
        }, function (_libGeometryShapes) {
            Cube = _libGeometryShapes.Cube;
        }, function (_libTextureCommon) {
            allocateTextureUnit = _libTextureCommon.allocateTextureUnit;
        }],
        execute: function () {
            'use strict';

            mat4 = glm.mat4;
            GL = WebGLRenderingContext;
            vertShaderSourceOLD = '\n    uniform mat4 cameraMatrix;\n    attribute mediump vec3 vertex;\n    varying mediump vec3 texcoord;\n\n    void main() {\n        gl_Position = cameraMatrix * vec4(vertex, 1.0);\n        texcoord = vertex;\n    }\n';
            vertShaderSource = '\n    uniform mat4 cameraMatrix;\n    attribute mediump vec3 vertex;\n    varying mediump vec3 texcoord;\n\n    void main() {\n        vec4 pos = cameraMatrix * vec4(vertex, 1.0);\n        gl_Position = pos.xyww;\n        texcoord = vertex;\n    }\n';
            fragShaderSource = '\n    precision mediump float;\n    varying vec3 texcoord;\n    uniform samplerCube skybox;\n\n    void main() {\n        gl_FragColor = textureCube(skybox, texcoord);\n    }\n';

            Skybox = (function (_Environment) {
                function Skybox(cubemap) {
                    var _this = this;

                    var options = arguments[1] === undefined ? {} : arguments[1];

                    _classCallCheck(this, Skybox);

                    _Environment.call(this, options);

                    this.cubemap = null;
                    this._onCubemapReady = _Promise.resolve(cubemap).then(function (cubemap) {
                        _this.cubemap = cubemap;
                    });

                    this.cube = new Cube();
                    this.program = null;
                    this.unit = null;
                    this.handle = null;
                    this.cubeRenderer = null;
                    this.locations = null;
                    this.initialized = false;
                    this.cameraMatrix = mat4.create();
                }

                _inherits(Skybox, _Environment);

                // Runs once for each instance by the renderer

                Skybox.prototype.initialize = function initialize(renderer) {
                    var _this2 = this;

                    _Environment.prototype.initialize.call(this, renderer);

                    var gl = this.gl = renderer.gl;

                    this.program = new GLProgram(gl, new GLShader(gl, fragShaderSource, GL.FRAGMENT_SHADER), new GLShader(gl, vertShaderSource, GL.VERTEX_SHADER));

                    this.unit = allocateTextureUnit(gl);
                    this.handle = gl.createTexture();

                    this.cubeRenderer = this.cube.getRenderer(gl);

                    this.locations = {
                        sampler: this.program.getUniformLocation('skybox'),
                        cameraMatrix: this.program.getUniformLocation('cameraMatrix')
                    };

                    this.cubeRenderer.vertexBuffer.setAttribLocation('vertex', this.program);

                    this._onCubemapReady.then(function () {

                        gl.activeTexture(GL.TEXTURE0 + _this2.unit);
                        gl.bindTexture(GL.TEXTURE_CUBE_MAP, _this2.handle);

                        gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
                        gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
                        gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE); //Prevents s-coordinate wrapping (repeating).
                        gl.texParameteri(GL.TEXTURE_CUBE_MAP, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE); //Prevents t-coordinate wrapping (repeating).

                        gl.texImage2D(GL.TEXTURE_CUBE_MAP_POSITIVE_X, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, _this2.cubemap.right);
                        gl.texImage2D(GL.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, _this2.cubemap.left);
                        gl.texImage2D(GL.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, _this2.cubemap.top);
                        gl.texImage2D(GL.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, _this2.cubemap.bottom);
                        gl.texImage2D(GL.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, _this2.cubemap.back);
                        gl.texImage2D(GL.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, _this2.cubemap.front);

                        gl.generateMipmap(GL.TEXTURE_CUBE_MAP);
                        gl.bindTexture(GL.TEXTURE_CUBE_MAP, null);

                        _this2.initialized = true;
                    });
                };

                Skybox.prototype.render = function render() {
                    this.gl.clear(GL.DEPTH_BUFFER_BIT);
                };

                Skybox.prototype.renderLast = function renderLast(renderer) {
                    if (this.initialized) {
                        var gl = this.program.gl;

                        //this.gl.clear(GL.DEPTH_BUFFER_BIT | GL.COLOR_BUFFER_BIT);

                        //const { depth } = gl.getContextAttributes();

                        //gl.depthMask(false);
                        gl.disable(GL.CULL_FACE);
                        gl.depthFunc(GL.LEQUAL);

                        this.program.use();

                        gl.uniform1i(this.locations.sampler, this.unit);

                        gl.activeTexture(GL.TEXTURE0 + this.unit);
                        gl.bindTexture(GL.TEXTURE_CUBE_MAP, this.handle);

                        mat4.copy(this.cameraMatrix, renderer.camera.viewMatrix);

                        this.cameraMatrix[12] = 0;
                        this.cameraMatrix[13] = 0;
                        this.cameraMatrix[14] = 0;

                        mat4.multiply(this.cameraMatrix, renderer.camera.projectionMatrix, this.cameraMatrix);

                        gl.uniformMatrix4fv(this.locations.cameraMatrix, false, this.cameraMatrix);

                        this.cubeRenderer.render();

                        //gl.depthMask(depth);
                        gl.enable(GL.CULL_FACE);
                        gl.depthFunc(GL.LESS);
                    }
                };

                return Skybox;
            })(Environment);

            _export('default', Skybox);
        }
    };
});
System.register('lib/webgl/shader', ['npm:babel-runtime@5.4.3/helpers/class-call-check', 'lib/extra/ajax'], function (_export) {
    var _classCallCheck, getString, GL, GLShader;

    return {
        setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_libExtraAjax) {
            getString = _libExtraAjax.getString;
        }],
        execute: function () {
            'use strict';

            GL = WebGLRenderingContext;

            GLShader = (function () {
                function GLShader(gl, source, type) {
                    _classCallCheck(this, GLShader);

                    this.gl = gl;
                    this.type = type;
                    this.handle = gl.createShader(type);

                    gl.shaderSource(this.handle, source);
                    gl.compileShader(this.handle);

                    var info = this.getInfoLog();
                    if (info !== '') {
                        console.error(info);
                    }
                }

                GLShader.prototype.destroy = function destroy() {
                    this.gl.deleteShader(this.handle);
                };

                GLShader.prototype.getInfoLog = function getInfoLog() {
                    return this.gl.getShaderInfoLog(this.handle);
                };

                GLShader.prototype.getSource = function getSource() {
                    return this.gl.getShaderSource(this.handle);
                };

                GLShader.prototype.getTranslatedSource = function getTranslatedSource() {
                    return this.gl.getExtension('WEBGL_debug_shaders').getTranslatedShaderSource(this.handle);
                };

                GLShader.fromFile = function fromFile(gl, filename) {
                    var type = ({ 'vert': GL.VERTEX_SHADER, 'frag': GL.FRAGMENT_SHADER })[filename.split('.').pop()];
                    return getString(filename).then(function (source) {
                        return new GLShader(gl, source, type);
                    });
                };

                return GLShader;
            })();

            _export('default', GLShader);
        }
    };
});
System.register('lib/workers/wavefront', ['lib/workers/worker-pool'], function (_export) {
    'use strict';

    var WorkerPool, workerpool;

    function wavefrontWorker(stringBuffer, resolve) {

        var timerName = 'Parsing OBJ file';

        console.time(timerName);

        var packed = { 'v': [], 'vt': [], 'vn': [], 'i': [] };

        var array = new Uint8Array(stringBuffer),
            char,
            c1,
            c2,
            c3,
            offset,
            row = [],
            len = array.length,
            i = 0;

        var times = [];

        // Iterate UTF-8 byte stream, to convert to JavaScript UTF-16 characters
        while (i < len) {

            c1 = array[i++];
            switch (c1 >> 4) {
                case 0:case 1:case 2:case 3:case 4:case 5:case 6:case 7:
                    // 0xxxxxxx
                    char = c1;
                    break;

                case 12:case 13:
                    // 110x xxxx   10xx xxxx
                    c2 = array[i++];
                    char = (c1 & 31) << 6 | c2 & 63;
                    break;

                case 14:
                    // 1110 xxxx  10xx xxxx  10xx xxxx
                    c2 = array[i++];
                    c3 = array[i++];
                    char = (c1 & 15) << 12 | (c2 & 63) << 6 | (c3 & 63) << 0;
                    break;
            }

            // If new line, create string and process
            if (char === 10) {

                var line = String.fromCharCode.apply(undefined, row).trim().split(/\s+/);

                var type = line[0],
                    data = line.slice(1);

                switch (type) {
                    case 'v':
                    case 'vn':
                    case 'vt':
                        for (var j = 0, len2 = data.length; j < len2; ++j) {
                            packed[type].push(parseFloat(data[j]));
                        }

                        //Array.prototype.push.apply(packed[type], data.map(parseFloat));
                        break;

                    case 'f':

                        var indices = [];
                        for (var j = 0, len2 = data.length; j < len2; ++j) {
                            indices.push(data[j].split('/').map(function (n, i) {
                                n = parseInt(n);
                                return n < 0 ? n + packed[['v', 'vt', 'vn'][i]].length / [3, 2, 3][i] : n - 1;
                            }));
                        }

                        // Repeat points to form a triangle
                        if (indices.length < 3) {
                            for (var j = indices.length; j <= 3; ++j) {
                                indices[j] = indices[indices.length - 1];
                            }
                        }

                        for (var j = 1, len2 = indices.length; j < len2 - 1; ++j) {
                            packed.i.push(indices[0], indices[j], indices[j + 1]);
                        }
                }

                row = [];
            } else {
                row.push(char);
            }
        }

        var uniqueIndices = {},
            counter = 0,
            unpackedUniqueIndices = [],
            unpackedVertexIndices = [],
            unpackedTexcoordIndices = [],
            unpackedNormalIndices = [];

        // Compute new, unique indices.
        for (i = 0, len = packed.i.length; i < len; i += 3) {
            for (var j = 0; j < 3; ++j) {
                var ids = packed.i[i + j],
                    v_id = ids[0],
                    vt_id = ids[1],
                    vn_id = ids[2],
                    key = ids.join(':'),
                    index = uniqueIndices[key];

                if (index === undefined) {
                    index = uniqueIndices[key] = counter++;
                    unpackedVertexIndices.push(v_id);

                    if (vt_id !== undefined) unpackedTexcoordIndices.push(vt_id);
                    if (vn_id !== undefined) unpackedNormalIndices.push(vn_id);
                }

                unpackedUniqueIndices.push(index);
            }
        }

        // The typed arrays to return.
        var indices = new Uint16Array(unpackedUniqueIndices),
            vertices = new Float32Array(3 * unpackedVertexIndices.length),
            normals = new Float32Array(3 * unpackedNormalIndices.length),
            texcoords = new Float32Array(2 * unpackedTexcoordIndices.length);

        for (i = 0, len = unpackedVertexIndices.length; i < len; ++i) {
            offset = 3 * i;

            var v_offset = 3 * unpackedVertexIndices[i];

            vertices[offset] = packed.v[v_offset];
            vertices[offset + 1] = packed.v[v_offset + 1];
            vertices[offset + 2] = packed.v[v_offset + 2];
        }

        for (i = 0, len = unpackedNormalIndices.length; i < len; ++i) {
            offset = 3 * i;

            var vn_offset = 3 * unpackedNormalIndices[i];

            normals[offset] = packed.vn[vn_offset];
            normals[offset + 1] = packed.vn[vn_offset + 1];
            normals[offset + 2] = packed.vn[vn_offset + 2];
        }

        for (i = 0, len = unpackedTexcoordIndices.length; i < len; ++i) {
            offset = 2 * i;

            var vt_offset = 2 * unpackedTexcoordIndices[i];

            texcoords[offset] = packed.vt[vt_offset];
            texcoords[offset + 1] = packed.vt[vt_offset + 1];
        }

        console.timeEnd(timerName);

        resolve({
            indices: indices,
            vertices: vertices,
            normals: normals,
            texcoords: texcoords
        }, [indices.buffer, vertices.buffer, normals.buffer, texcoords.buffer]);
    }

    return {
        setters: [function (_libWorkersWorkerPool) {
            WorkerPool = _libWorkersWorkerPool['default'];
        }],
        execute: function () {
            workerpool = WorkerPool.fromFunction(wavefrontWorker);

            _export('workerpool', workerpool);
        }
    };
});
System.register('lib/workers/normal-vectors', ['lib/workers/worker-pool', 'github:toji/gl-matrix@master/src/gl-matrix/vec3.js!github:systemjs/plugin-text@0.0.2'], function (_export) {
    'use strict';

    var WorkerPool, vec3Module, workerpool;

    function normalVectorWorker(data, resolve) {

        console.time('Calculating normals');

        var vertices = data.vertices,
            indices = data.indices;

        var normals = new Float32Array(vertices.length);

        // Array to store adjacent triangle offsets for each vertex.
        // :: Vertex -> [Triangle]
        var adjacentTriangles = new Array(vertices.length / 3);

        // Packed normals for each triangle.
        // :: Triangle -> Normal
        var triangleNormals = new Float32Array(indices.length);

        // Pre-allocate triangle arrays for each vertex.
        for (var i = 0, len = adjacentTriangles.length; i < len; ++i) {
            adjacentTriangles[i] = [];
        }

        // Calculate adjacent triangles
        for (var offset = 0, len = indices.length; offset < len; offset += 3) {

            // Fetch id:s for vertices in triangle
            var v0_id = indices[offset],
                v1_id = indices[offset + 1],
                v2_id = indices[offset + 2];

            var v0_offset = 3 * v0_id,
                v1_offset = 3 * v1_id,
                v2_offset = 3 * v2_id;

            // Fetch vertex vectors
            var v0 = vec3.set(tmp0, vertices[v0_offset], vertices[v0_offset + 1], vertices[v0_offset + 2]),
                v1 = vec3.set(tmp1, vertices[v1_offset], vertices[v1_offset + 1], vertices[v1_offset + 2]),
                v2 = vec3.set(tmp2, vertices[v2_offset], vertices[v2_offset + 1], vertices[v2_offset + 2]);

            // Store current triangle offsets for each vertex in triangle.
            adjacentTriangles[v0_id].push(offset);
            adjacentTriangles[v1_id].push(offset);
            adjacentTriangles[v2_id].push(offset);

            // Calculate area-weighted normal vectors by not normalizing the cross product
            var normal = vec3.cross(tmp0, vec3.subtract(tmp1, v1, v0), vec3.subtract(tmp2, v2, v0));

            // Store the calculated "normal"
            triangleNormals[offset] = normal[0];
            triangleNormals[offset + 1] = normal[1];
            triangleNormals[offset + 2] = normal[2];
        }

        // Iterate all vertices
        for (var vertex = 0, _len = adjacentTriangles.length; vertex < _len; ++vertex) {

            var vertexNormal = vec3.set(tmp0, 0, 0, 0);
            var triangles = adjacentTriangles[vertex];

            // Iterate all adjacent triangles
            for (var _i = 0, len2 = triangles.length; _i < len2; ++_i) {
                var triangleOffset = triangles[_i];

                vertexNormal[0] += triangleNormals[triangleOffset];
                vertexNormal[1] += triangleNormals[triangleOffset + 1];
                vertexNormal[2] += triangleNormals[triangleOffset + 2];
            }

            vec3.normalize(vertexNormal, vertexNormal);

            var offset = 3 * vertex;

            // Store calculated normal
            normals[offset] = vertexNormal[0];
            normals[offset + 1] = vertexNormal[1];
            normals[offset + 2] = vertexNormal[2];
        }

        console.timeEnd('Calculating normals');

        resolve({
            indices: indices,
            vertices: vertices,
            normals: normals
        }, [indices.buffer, vertices.buffer, normals.buffer]);
    }

    return {
        setters: [function (_libWorkersWorkerPool) {
            WorkerPool = _libWorkersWorkerPool['default'];
        }, function (_githubTojiGlMatrixMasterSrcGlMatrixVec3JsGithubSystemjsPluginText002) {
            vec3Module = _githubTojiGlMatrixMasterSrcGlMatrixVec3JsGithubSystemjsPluginText002['default'];
        }],
        execute: function () {
            workerpool = WorkerPool.fromFunction(normalVectorWorker, ['var GLMAT_ARRAY_TYPE = Float32Array;', vec3Module, 'var tmp0 = vec3.create(), tmp1 = vec3.create(), tmp2 = vec3.create();']);

            _export('workerpool', workerpool);
        }
    };
});
System.register('lib/material/base', ['npm:babel-runtime@5.4.3/helpers/class-call-check', 'lib/extra/errors'], function (_export) {
  var _classCallCheck, UnimplementedMethodError, GL, Material, MaterialRenderer;

  return {
    setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
      _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
    }, function (_libExtraErrors) {
      UnimplementedMethodError = _libExtraErrors.UnimplementedMethodError;
    }],
    execute: function () {
      'use strict';

      GL = WebGLRenderingContext;

      /**
       * Interface for materials.
       */

      Material = (function () {
        function Material() {
          _classCallCheck(this, Material);
        }

        /**
         * Returns a renderer bound to this material instance.
         * Should always produce the same instance for each WebGL rendering context and material.
         */

        Material.prototype.getRenderer = function getRenderer(gl) {
          throw new UnimplementedMethodError();
        };

        return Material;
      })();

      _export('Material', Material);

      /**
       * Interface for material renderers. Bound to a specific material and WebGL rendering context.
       */

      MaterialRenderer = (function () {
        function MaterialRenderer(material) {
          _classCallCheck(this, MaterialRenderer);

          this.material = material;
          this.program = null;
          this.geometryRenderer = null;
        }

        MaterialRenderer.prototype.init = function init(renderer) {
          throw new UnimplementedMethodError();
        };

        /**
         * Runs once for each geometry using this material.
         * Should be used to bind geometry buffers to program attributes, and cache uniforms locations.
         */

        MaterialRenderer.prototype.setGeometryRenderer = function setGeometryRenderer(geometryRenderer) {};

        /**
         * Runs once per loop before drawing the models using the material.
         * Should be used to set material uniforms independent of model drawn.
         */

        MaterialRenderer.prototype.beforeRender = function beforeRender(renderer) {};

        /**
         * Runs before drawing each model using the material.
         * Should be used to set material uniforms dependent on model drawn.
         */

        MaterialRenderer.prototype.render = function render(model, renderer) {};

        /**
         * Runs after all models using the bound material have been drawn.
         * Should be used to clean up modified state.
         */

        MaterialRenderer.prototype.afterRender = function afterRender(renderer) {};

        return MaterialRenderer;
      })();

      _export('MaterialRenderer', MaterialRenderer);
    }
  };
});
System.register('lib/workers/tga', ['lib/workers/worker-pool', 'github:maxdavidson/jsTGALoader@master/tga.js!github:systemjs/plugin-text@0.0.2'], function (_export) {
    'use strict';

    var WorkerPool, targaModule, workerpool;

    function TGAworker(tgaBuffer, resolve) {
        var tga = new TGA();
        tga.load(new Uint8Array(tgaBuffer));
        var imageData = tga.getImageData();
        var buffer = imageData.data.buffer;
        resolve({
            buffer: buffer,
            height: imageData.height,
            width: imageData.width
        }, [buffer]);
    }

    return {
        setters: [function (_libWorkersWorkerPool) {
            WorkerPool = _libWorkersWorkerPool['default'];
        }, function (_githubMaxdavidsonJsTGALoaderMasterTgaJsGithubSystemjsPluginText002) {
            targaModule = _githubMaxdavidsonJsTGALoaderMasterTgaJsGithubSystemjsPluginText002['default'];
        }],
        execute: function () {
            workerpool = WorkerPool.fromFunction(TGAworker, [targaModule]);

            _export('workerpool', workerpool);
        }
    };
});
System.register('lib/light/base', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/helpers/object-without-properties', 'npm:babel-runtime@5.4.3/core-js/weak-map', 'github:toji/gl-matrix@master', 'lib/scene/base', 'npm:memoizee@0.3.8', 'lib/extra/color'], function (_export) {
    var _inherits, _classCallCheck, _objectWithoutProperties, _WeakMap, glm, Scene, memoize, convertColorToVector, vec3, Light, lightCounts, LightRenderer;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543HelpersObjectWithoutProperties) {
            _objectWithoutProperties = _npmBabelRuntime543HelpersObjectWithoutProperties['default'];
        }, function (_npmBabelRuntime543CoreJsWeakMap) {
            _WeakMap = _npmBabelRuntime543CoreJsWeakMap['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }, function (_libSceneBase) {
            Scene = _libSceneBase['default'];
        }, function (_npmMemoizee038) {
            memoize = _npmMemoizee038['default'];
        }, function (_libExtraColor) {
            convertColorToVector = _libExtraColor.convertColorToVector;
        }],
        execute: function () {
            'use strict';

            vec3 = glm.vec3;

            /**
             * @abstract
             */

            Light = (function (_Scene) {
                function Light(name, RendererType) {
                    var _this = this;

                    var _ref = arguments[2] === undefined ? {} : arguments[2];

                    var _ref$diffuse = _ref.diffuse;
                    var diffuse = _ref$diffuse === undefined ? 16777215 : _ref$diffuse;
                    var _ref$specular = _ref.specular;
                    var specular = _ref$specular === undefined ? diffuse : _ref$specular;

                    var options = _objectWithoutProperties(_ref, ['diffuse', 'specular']);

                    _classCallCheck(this, Light);

                    _Scene.call(this, name, options);

                    this.diffuse = diffuse;
                    this.specular = specular;

                    this.worldPosition = vec3.create();

                    this._lastDiffuse = null;
                    this._lastSpecular = null;

                    this._diffuseVector = convertColorToVector(this.diffuse);
                    this._specularVector = convertColorToVector(this.specular);

                    this.getRenderer = memoize(function (gl) {
                        return new RendererType(_this, gl);
                    });
                }

                _inherits(Light, _Scene);

                Light.prototype.recalculate = function recalculate(existingNodes) {
                    if (this.diffuse !== this._lastDiffuse || this.specular !== this._lastSpecular) {
                        convertColorToVector(this.diffuse, this._diffuseVector);
                        convertColorToVector(this.specular, this._specularVector);

                        this._lastDiffuse = this.diffuse;
                        this._lastSpecular = this.specular;
                    }

                    var dirty = _Scene.prototype.recalculate.call(this, existingNodes);

                    if (dirty) {
                        if (this.parent) {
                            vec3.transformMat4(this.worldPosition, this.position, this.parent.worldTransform);
                        } else {
                            vec3.copy(this.worldPosition, this.position);
                        }
                    }

                    return dirty;
                };

                return Light;
            })(Scene);

            _export('Light', Light);

            lightCounts = new _WeakMap();

            /**
             * @abstract
             */

            LightRenderer = (function () {
                function LightRenderer(light, gl) {
                    _classCallCheck(this, LightRenderer);

                    this.light = light;
                    this.gl = gl;
                    this.id = LightRenderer.allocateLight(light.constructor);

                    this.getLocations = memoize(this.getLocations.bind(this));
                }

                LightRenderer.allocateLight = function allocateLight(LightType) {
                    var count = lightCounts.get(LightType) || 0;
                    lightCounts.set(LightType, count + 1);
                    return count;
                };

                LightRenderer.prototype.getLocations = function getLocations(program) {};

                LightRenderer.prototype.render = function render() {};

                return LightRenderer;
            })();

            _export('LightRenderer', LightRenderer);
        }
    };
});
System.register('lib/extra/helpers', ['npm:babel-runtime@5.4.3/helpers/bind', 'npm:babel-runtime@5.4.3/core-js/promise', 'npm:babel-runtime@5.4.3/core-js/object/keys', 'npm:babel-runtime@5.4.3/core-js/object/assign', 'lib/scene/model', 'lib/scene/group', 'lib/camera/perspective-camera', 'lib/geometry/geometry', 'lib/material/phong', 'lib/texture/texture2d', 'lib/texture/cubemap', 'lib/geometry/shapes'], function (_export) {
    var _bind, _Promise, _Object$keys, _Object$assign, Model, Group, PerspectiveCamera, Geometry, PhongMaterial, Texture2D, CubeMap, Plane, Cube;

    function terrain(url) {
        return Texture2D.fromFile(url).then(function (heightmap) {
            return new Plane({ heightmap: heightmap });
        }).then(function (geometry) {
            return geometry.generateNormals();
        });
    }

    function cube() {
        return new Cube();
    }

    function plane() {
        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
        }

        return new (_bind.apply(Plane, [null].concat(args)))();
    }

    function camera() {
        var options = arguments[0] === undefined ? {} : arguments[0];

        return new PerspectiveCamera(options);
    }

    function pointlight() {
        var options = arguments[0] === undefined ? {} : arguments[0];

        return new PointLight(options);
    }

    function spotlight() {
        var options = arguments[0] === undefined ? {} : arguments[0];

        return new SpotLight(options);
    }

    function geometry(url) {
        return Geometry.fromFile(url);
    }

    function texture2d(url) {
        return Texture2D.fromFile(url);
    }

    function cubemap() {
        for (var _len2 = arguments.length, urls = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
            urls[_key2] = arguments[_key2];
        }

        return CubeMap.fromFiles.apply(CubeMap, urls);
    }

    function phong() {
        var options = arguments[0] === undefined ? {} : arguments[0];

        // Transform the values to promises, wait for all to finish, put back into an object, and create the material.
        return _Promise.all(_Object$keys(options).map(function (key) {
            return _Promise.resolve(options[key]).then(function (value) {
                var _ref;

                return (_ref = {}, _ref[key] = value, _ref);
            });
        })).then(function (pairs) {
            return _Object$assign.apply(Object, [{}].concat(pairs));
        }).then(function (options) {
            return new PhongMaterial(options);
        });
    }

    function model() {
        for (var _len3 = arguments.length, args = Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
            args[_key3] = arguments[_key3];
        }

        return new (_bind.apply(Model, [null].concat(args)))();
    }

    function group() {
        for (var _len4 = arguments.length, args = Array(_len4), _key4 = 0; _key4 < _len4; _key4++) {
            args[_key4] = arguments[_key4];
        }

        return new (_bind.apply(Group, [null].concat(args)))();
    }

    return {
        setters: [function (_npmBabelRuntime543HelpersBind) {
            _bind = _npmBabelRuntime543HelpersBind['default'];
        }, function (_npmBabelRuntime543CoreJsPromise) {
            _Promise = _npmBabelRuntime543CoreJsPromise['default'];
        }, function (_npmBabelRuntime543CoreJsObjectKeys) {
            _Object$keys = _npmBabelRuntime543CoreJsObjectKeys['default'];
        }, function (_npmBabelRuntime543CoreJsObjectAssign) {
            _Object$assign = _npmBabelRuntime543CoreJsObjectAssign['default'];
        }, function (_libSceneModel) {
            Model = _libSceneModel['default'];
        }, function (_libSceneGroup) {
            Group = _libSceneGroup['default'];
        }, function (_libCameraPerspectiveCamera) {
            PerspectiveCamera = _libCameraPerspectiveCamera['default'];
        }, function (_libGeometryGeometry) {
            Geometry = _libGeometryGeometry['default'];
        }, function (_libMaterialPhong) {
            PhongMaterial = _libMaterialPhong['default'];
        }, function (_libTextureTexture2d) {
            Texture2D = _libTextureTexture2d['default'];
        }, function (_libTextureCubemap) {
            CubeMap = _libTextureCubemap['default'];
        }, function (_libGeometryShapes) {
            Plane = _libGeometryShapes.Plane;
            Cube = _libGeometryShapes.Cube;
        }],
        execute: function () {
            'use strict';

            _export('terrain', terrain);

            _export('cube', cube);

            _export('plane', plane);

            _export('camera', camera);

            _export('pointlight', pointlight);

            _export('spotlight', spotlight);

            _export('geometry', geometry);

            _export('texture2d', texture2d);

            _export('cubemap', cubemap);

            _export('phong', phong);

            _export('model', model);

            _export('group', group);
        }
    };
});
System.register('lib/webgl/program', ['npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/helpers/bind', 'npm:babel-runtime@5.4.3/core-js/map', 'npm:babel-runtime@5.4.3/core-js/promise', 'lib/webgl/shader'], function (_export) {
    var _classCallCheck, _bind, _Map, _Promise, GLShader, GL, enums, GLProgram;

    return {
        setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543HelpersBind) {
            _bind = _npmBabelRuntime543HelpersBind['default'];
        }, function (_npmBabelRuntime543CoreJsMap) {
            _Map = _npmBabelRuntime543CoreJsMap['default'];
        }, function (_npmBabelRuntime543CoreJsPromise) {
            _Promise = _npmBabelRuntime543CoreJsPromise['default'];
        }, function (_libWebglShader) {
            GLShader = _libWebglShader['default'];
        }],
        execute: function () {
            'use strict';

            GL = WebGLRenderingContext;

            // Taken from the WebGl spec:
            // http://www.khronos.org/registry/webgl/specs/latest/1.0/#5.14
            enums = {
                35664: 'FLOAT_VEC2',
                35665: 'FLOAT_VEC3',
                35666: 'FLOAT_VEC4',
                35667: 'INT_VEC2',
                35668: 'INT_VEC3',
                35669: 'INT_VEC4',
                35670: 'BOOL',
                35671: 'BOOL_VEC2',
                35672: 'BOOL_VEC3',
                35673: 'BOOL_VEC4',
                35674: 'FLOAT_MAT2',
                35675: 'FLOAT_MAT3',
                35676: 'FLOAT_MAT4',
                35678: 'SAMPLER_2D',
                35680: 'SAMPLER_CUBE',
                5120: 'BYTE',
                5121: 'UNSIGNED_BYTE',
                5122: 'SHORT',
                5123: 'UNSIGNED_SHORT',
                5124: 'INT',
                5125: 'UNSIGNED_INT',
                5126: 'FLOAT'
            };

            /**
             * Wraps a WebGL Shader program
             */

            GLProgram = (function () {
                function GLProgram(gl) {
                    for (var _len = arguments.length, shaders = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                        shaders[_key - 1] = arguments[_key];
                    }

                    _classCallCheck(this, GLProgram);

                    this.gl = gl;

                    this.handle = gl.createProgram();
                    this.vertexShader = shaders.filter(function (shader) {
                        return shader.type === GL.VERTEX_SHADER;
                    })[0] || null;
                    this.fragmentShader = shaders.filter(function (shader) {
                        return shader.type === GL.FRAGMENT_SHADER;
                    })[0] || null;

                    this._attribLocationCache = new _Map();
                    this._uniformLocationCache = new _Map();

                    if ([this.vertexShader, this.fragmentShader].some(function (shader) {
                        return shader === null;
                    })) {
                        throw 'You need to supply both a vertex and a fragment shader!';
                    }

                    gl.attachShader(this.handle, this.vertexShader.handle);
                    gl.attachShader(this.handle, this.fragmentShader.handle);
                    gl.linkProgram(this.handle);

                    var info = this.getInfoLog();
                    if (info !== '') {
                        console.error(info);
                    }
                }

                GLProgram.prototype.use = function use() {
                    this.gl.useProgram(this.handle);
                };

                GLProgram.prototype.destroy = function destroy() {
                    this.gl.deleteProgram(this.handle);
                };

                GLProgram.prototype.getUniformLocation = function getUniformLocation(location) {
                    var value = this._uniformLocationCache.get(location);
                    if (value === undefined) {
                        value = this.gl.getUniformLocation(this.handle, location);
                        if (value === null) console.error('Couldn\'t get uniform location: ' + location);
                        this._uniformLocationCache.set(location, value);
                    }
                    return value;
                };

                GLProgram.prototype.getAttribLocation = function getAttribLocation(location) {
                    var value = this._attribLocationCache.get(location);
                    if (value === undefined) {
                        value = this.gl.getAttribLocation(this.handle, location);
                        if (value === null) console.error('Couldn\'t get attribute location: ' + location);
                        this._attribLocationCache.set(location, value);
                    }
                    return value;
                };

                GLProgram.prototype.getInfoLog = function getInfoLog() {
                    return this.gl.getProgramInfoLog(this.handle);
                };

                GLProgram.prototype.getActiveUniforms = function getActiveUniforms() {
                    var uniforms = [];

                    for (var i = 0; i < this.gl.getProgramParameter(this.handle, GL.ACTIVE_UNIFORMS); ++i) {
                        var uniform = this.gl.getActiveUniform(this.handle, i);
                        uniform.typeName = enums[uniform.type];
                        uniform.value = this.gl.getUniform(this.handle, this.gl.getUniformLocation(this.handle, uniform.name));
                        uniforms.push(uniform);
                    }

                    return uniforms;
                };

                GLProgram.prototype.getActiveAttributes = function getActiveAttributes() {
                    var attributes = [];

                    for (var i = 0; i < this.gl.getProgramParameter(this.handle, GL.ACTIVE_ATTRIBUTES); ++i) {
                        var attribute = this.gl.getActiveAttrib(this.handle, i);
                        attribute.typeName = enums[attribute.type];
                        attributes.push(attribute);
                    }
                    return attributes;
                };

                GLProgram.fromShaderPromises = function fromShaderPromises(gl) {
                    for (var _len2 = arguments.length, shaderPromises = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
                        shaderPromises[_key2 - 1] = arguments[_key2];
                    }

                    return _Promise.all(shaderPromises).then(function (shaders) {
                        return new (_bind.apply(GLProgram, [null].concat([gl], shaders)))();
                    });
                };

                GLProgram.fromShaderFiles = function fromShaderFiles(gl) {
                    for (var _len3 = arguments.length, shaderFilenames = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
                        shaderFilenames[_key3 - 1] = arguments[_key3];
                    }

                    return GLProgram.fromShaderPromises(gl, shaderFilenames.map(function (filename) {
                        return GLShader.fromFile(gl, filename);
                    }));
                };

                GLProgram.prototype.setUniform = function setUniform(location, value) {
                    this.gl.uniform1f(this.getUniformLocation(location), value);
                };

                GLProgram.prototype.setUniformInt = function setUniformInt(location, value) {
                    this.gl.uniform1i(this.getUniformLocation(location), value);
                };

                GLProgram.prototype.setUniformVector = function setUniformVector(location, vector) {
                    var uniformLocation = this.getUniformLocation(location);
                    switch (vector.length) {
                        case 1:
                            this.gl.uniform1fv(uniformLocation, vector);break;
                        case 2:
                            this.gl.uniform2fv(uniformLocation, vector);break;
                        case 3:
                            this.gl.uniform3fv(uniformLocation, vector);break;
                        case 4:
                            this.gl.uniform4fv(uniformLocation, vector);
                    }
                };

                GLProgram.prototype.setUniformIntVector = function setUniformIntVector(location, vector) {
                    var uniformLocation = this.getUniformLocation(location);
                    switch (vector.length) {
                        case 1:
                            this.gl.uniform1iv(uniformLocation, vector);break;
                        case 2:
                            this.gl.uniform2iv(uniformLocation, vector);break;
                        case 3:
                            this.gl.uniform3iv(uniformLocation, vector);break;
                        case 4:
                            this.gl.uniform4iv(uniformLocation, vector);
                    }
                };

                GLProgram.prototype.setUniformMatrix = function setUniformMatrix(location, matrix) {
                    var transpose = arguments[2] === undefined ? false : arguments[2];

                    var uniformLocation = this.getUniformLocation(location);
                    switch (matrix.length) {
                        case 4:
                            this.gl.uniformMatrix2fv(uniformLocation, transpose, matrix);break;
                        case 9:
                            this.gl.uniformMatrix3fv(uniformLocation, transpose, matrix);break;
                        case 16:
                            this.gl.uniformMatrix4fv(uniformLocation, transpose, matrix);
                    }
                };

                return GLProgram;
            })();

            _export('default', GLProgram);
        }
    };
});
System.register('lib/texture/common', ['npm:babel-runtime@5.4.3/core-js/map', 'npm:babel-runtime@5.4.3/core-js/promise', 'lib/extra/ajax', 'lib/workers/tga'], function (_export) {
    var _Map, _Promise, getArrayBuffer, tgaWorker, textureCounts, source, target, converters;

    function allocateTextureUnit(gl) {
        var count = textureCounts.get(gl) || 0;
        textureCounts.set(gl, count + 1);
        return count;
    }

    function resizeImageData(imageData) {
        var width = arguments[1] === undefined ? imageData.width : arguments[1];
        var height = arguments[2] === undefined ? imageData.height : arguments[2];
        return (function () {
            // Resize source canvas to image's dimensions
            source.canvas.width = imageData.width;
            source.canvas.height = imageData.height;
            source.putImageData(imageData, 0, 0);

            // Resize target canvas to target dimensions
            target.canvas.width = width;
            target.canvas.height = height;
            target.drawImage(source.canvas, 0, 0, width, height);

            return target.getImageData(0, 0, width, height);
        })();
    }

    function getImage(filename) {
        var format = arguments[1] === undefined ? filename.split('.').pop() : arguments[1];
        return (function () {
            return (converters[format] || getNativeImage)(filename);
        })();
    }

    // Try using the browser's built-in image support to download an image.
    function getNativeImage(filename) {
        return new _Promise(function (resolve, reject) {
            var img = document.createElement('img');

            var onLoad = function onLoad() {
                // Convert image element to ImageData by drawing into a canvas and then extracting the content

                source.canvas.width = img.width;
                source.canvas.height = img.height;
                source.drawImage(img, 0, 0);

                var imageData = source.getImageData(0, 0, img.width, img.height);
                removeListeners();
                resolve(imageData);
            };

            var onError = function onError(error) {
                reject(error);
                removeListeners();
            };

            var removeListeners = function removeListeners() {
                img.removeEventListener('load', onLoad);
                img.removeEventListener('error', onError);
            };

            img.addEventListener('error', onError, false);
            img.addEventListener('load', onLoad, false);

            // Trigger download by setting the source
            img.src = filename;
        });
    }

    // Use the TGA library to download the image as a binary file and parse it.
    function getTgaImage(filename) {
        return getArrayBuffer(filename).then(function (tgaBuffer) {
            return tgaWorker.run(tgaBuffer, { transfers: [tgaBuffer] });
        }).then(function (_ref) {
            var buffer = _ref.buffer;
            var width = _ref.width;
            var height = _ref.height;

            var data = new Uint8ClampedArray(buffer);

            var image = undefined;
            try {
                // Not suppported in all versions
                image = new ImageData(data, width, height);
            } catch (e) {
                source.canvas.height = height;
                source.canvas.width = width;
                image = source.createImageData(width, height);
                image.data.set(data);
            }

            return image;
        });
    }
    return {
        setters: [function (_npmBabelRuntime543CoreJsMap) {
            _Map = _npmBabelRuntime543CoreJsMap['default'];
        }, function (_npmBabelRuntime543CoreJsPromise) {
            _Promise = _npmBabelRuntime543CoreJsPromise['default'];
        }, function (_libExtraAjax) {
            getArrayBuffer = _libExtraAjax.getArrayBuffer;
        }, function (_libWorkersTga) {
            tgaWorker = _libWorkersTga.workerpool;
        }],
        execute: function () {
            'use strict';

            _export('allocateTextureUnit', allocateTextureUnit);

            _export('resizeImageData', resizeImageData);

            _export('getImage', getImage);

            // Keeps track of texture counts for each rendering context.
            textureCounts = new _Map();
            source = document.createElement('canvas').getContext('2d');
            target = document.createElement('canvas').getContext('2d');
            converters = {
                tga: getTgaImage
            };
        }
    };
});
System.register('lib/light/directional-light', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/object/freeze', 'github:toji/gl-matrix@master', 'npm:memoizee@0.3.8', 'lib/extra/functional', 'lib/light/base'], function (_export) {
    var _inherits, _classCallCheck, _Object$freeze, glm, memoize, construct, Light, LightRenderer, vec3, forward, DirectionalLight, DirectionalLightRenderer;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsObjectFreeze) {
            _Object$freeze = _npmBabelRuntime543CoreJsObjectFreeze['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }, function (_npmMemoizee038) {
            memoize = _npmMemoizee038['default'];
        }, function (_libExtraFunctional) {
            construct = _libExtraFunctional.construct;
        }, function (_libLightBase) {
            Light = _libLightBase.Light;
            LightRenderer = _libLightBase.LightRenderer;
        }],
        execute: function () {
            'use strict';

            vec3 = glm.vec3;
            forward = vec3.fromValues(0, 0, -1);

            DirectionalLight = (function (_Light) {
                function DirectionalLight() {
                    var options = arguments[0] === undefined ? {} : arguments[0];

                    _classCallCheck(this, DirectionalLight);

                    _Light.call(this, 'directional-light', DirectionalLightRenderer, options);

                    this.direction = vec3.create();
                }

                _inherits(DirectionalLight, _Light);

                DirectionalLight.prototype.recalculate = function recalculate(existingNodes) {
                    var dirty = _Light.prototype.recalculate.call(this, existingNodes);

                    if (dirty) {
                        var direction = this.direction;
                        var orientation = this.orientation;

                        var x = orientation[0],
                            y = orientation[1],
                            z = orientation[2],
                            w = orientation[3];

                        direction[0] = -2 * (x * z + y * w);
                        direction[1] = 2 * (x * w - y * z);
                        direction[2] = x * x + y * y - (z * z + w * w);
                    }

                    return dirty;
                };

                return DirectionalLight;
            })(Light);

            _export('default', DirectionalLight);

            DirectionalLightRenderer = (function (_LightRenderer) {
                function DirectionalLightRenderer(light, gl) {
                    _classCallCheck(this, DirectionalLightRenderer);

                    _LightRenderer.call(this, light, gl);
                    //Object.freeze(this);
                }

                _inherits(DirectionalLightRenderer, _LightRenderer);

                DirectionalLightRenderer.prototype.getLocations = function getLocations(program) {
                    return _Object$freeze({
                        direction: program.getUniformLocation('directionalLights[' + this.id + '].direction'),
                        diffuse: program.getUniformLocation('directionalLights[' + this.id + '].diffuse'),
                        specular: program.getUniformLocation('directionalLights[' + this.id + '].specular')
                    });
                };

                DirectionalLightRenderer.prototype.render = function render(program) {
                    var gl = this.gl;
                    var light = this.light;
                    var locations = this.getLocations(program);

                    gl.uniform3fv(locations.direction, light.direction); // Only local direction used
                    gl.uniform3fv(locations.diffuse, light._diffuseVector);
                    gl.uniform3fv(locations.specular, light._specularVector);
                };

                return DirectionalLightRenderer;
            })(LightRenderer);
        }
    };
});
System.register('lib/control/mouseview', ['npm:babel-runtime@5.4.3/helpers/class-call-check', 'github:baconjs/bacon.js@0.7.58', 'github:toji/gl-matrix@master'], function (_export) {
    var _classCallCheck, Bacon, glm, vec3, mat4, quat, equals, buffer, MouseViewController;

    return {
        setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_githubBaconjsBaconJs0758) {
            Bacon = _githubBaconjsBaconJs0758['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }],
        execute: function () {
            'use strict';

            vec3 = glm.vec3;
            mat4 = glm.mat4;
            quat = glm.quat;

            equals = function equals(a) {
                return function (b) {
                    return a === b;
                };
            };

            buffer = vec3.create();

            MouseViewController = (function () {
                function MouseViewController(target, renderer) {
                    var _this = this;

                    var _ref = arguments[2] === undefined ? {} : arguments[2];

                    var _ref$speed = _ref.speed;
                    var speed = _ref$speed === undefined ? 1 : _ref$speed;

                    _classCallCheck(this, MouseViewController);

                    this.target = target;

                    this.yaw = 0;
                    this.pitch = 0;
                    this.roll = 0;

                    this.forward = 0;
                    this.sideways = 0;
                    this.turn = 0;

                    this.locked = false;
                    this.moving = false;
                    this.first = true;

                    this.speed = speed;

                    var canvas = renderer.canvas;

                    var _map = ['keydown', 'keyup'].map(function (e) {
                        return Bacon.fromEventTarget(document.body, e).map(function (e) {
                            return e.keyCode;
                        });
                    });

                    var onKeyDown = _map[0];
                    var onKeyUp = _map[1];

                    // Creates an observable Bacon.Property from a keyCode
                    var fromKeypress = function fromKeypress(keyCode) {
                        return Bacon.mergeAll(onKeyDown.filter(equals(keyCode)).map(function () {
                            return true;
                        }), onKeyUp.filter(equals(keyCode)).map(function () {
                            return false;
                        })).skipDuplicates().toProperty(false);
                    };

                    var _WASDQE$split$map$map = 'WASDQE'.split('').map(function (char) {
                        return char.charCodeAt(0);
                    }).map(fromKeypress);

                    var up = _WASDQE$split$map$map[0];
                    var left = _WASDQE$split$map$map[1];
                    var down = _WASDQE$split$map$map[2];
                    var right = _WASDQE$split$map$map[3];
                    var ccw = _WASDQE$split$map$map[4];
                    var cw = _WASDQE$split$map$map[5];

                    var _map2 = [[right, left], [down, up], [ccw, cw]].map(function (_ref2) {
                        var positive = _ref2[0];
                        var negative = _ref2[1];
                        return Bacon.combineWith(function (a, b) {
                            return a + b;
                        }, positive.map(function (b) {
                            return +b;
                        }), negative.map(function (b) {
                            return -b;
                        }));
                    });

                    var x = _map2[0];
                    var y = _map2[1];
                    var z = _map2[2];

                    x.onValue(function (val) {
                        _this.sideways = val;
                    });
                    y.onValue(function (val) {
                        _this.forward = val;
                    });
                    z.onValue(function (val) {
                        _this.turn = val;
                    });

                    var that = this;

                    Bacon.combineWith(function () {
                        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                            args[_key] = arguments[_key];
                        }

                        return args.some(function (b) {
                            return b;
                        });
                    }, up, left, down, right, ccw, cw).onValue(function (moving) {
                        that.moving = moving;
                    });

                    onKeyDown.filter(equals('F'.charCodeAt(0))).onValue(function (key) {
                        if (canvas.requestFullscreen) {
                            canvas.requestFullscreen();
                        } else if (canvas.msRequestFullscreen) {
                            canvas.msRequestFullscreen();
                        } else if (canvas.mozRequestFullScreen) {
                            canvas.mozRequestFullScreen();
                        } else if (canvas.webkitRequestFullscreen) {
                            canvas.webkitRequestFullscreen();
                        }
                    });

                    onKeyDown.filter(equals('C'.charCodeAt(0))).onValue(function () {
                        window.cull = !window.cull;
                    });

                    canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock || function () {};

                    canvas.addEventListener('click', function () {
                        canvas.requestPointerLock();
                    }, false);

                    var sensitivity = 0.1;

                    function savePosition(e) {
                        var movementX = e.movementX !== undefined ? e.movementX : e.mozMovementX;
                        var movementY = e.movementY !== undefined ? e.movementY : e.mozMovementY;

                        that.pitch = Math.max(-90, Math.min(90, that.pitch + sensitivity * movementY));
                        that.yaw += sensitivity * movementX;
                        that.yaw = that.yaw % 360;
                    }

                    function lockChangeAlert() {
                        if (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas) {
                            console.log('The pointer lock status is now locked');
                            document.addEventListener('mousemove', savePosition, false);
                            that.locked = true;
                        } else {
                            console.log('The pointer lock status is now unlocked');
                            document.removeEventListener('mousemove', savePosition, false);
                            that.locked = false;
                        }
                    }

                    document.addEventListener('pointerlockchange', lockChangeAlert, false);
                    document.addEventListener('mozpointerlockchange', lockChangeAlert, false);

                    this.touching = false;

                    var touchSensitivity = 0.2;

                    var prevPitch = undefined,
                        prevYaw = undefined;
                    var startX = undefined,
                        startY = undefined,
                        currentX = undefined,
                        currentY = undefined;
                    function saveMove(e) {
                        e.preventDefault();
                        currentX = e.touches[0].pageX;
                        currentY = e.touches[0].pageY;

                        var movementX = startX - currentX;
                        var movementY = startY - currentY;

                        that.pitch = Math.max(-90, Math.min(90, prevPitch + touchSensitivity * movementY));
                        that.yaw = prevYaw + touchSensitivity * movementX;
                        that.yaw = that.yaw % 360;
                    }

                    canvas.addEventListener('touchstart', function (e) {
                        canvas.addEventListener('touchmove', saveMove, false);
                        prevPitch = _this.pitch;
                        prevYaw = _this.yaw;
                        startX = e.touches[0].pageX;
                        startY = e.touches[0].pageY;
                        that.touching = true;
                    }, false);

                    canvas.addEventListener('touchend', function (e) {
                        canvas.removeEventListener('touchmove', saveMove, false);
                        that.touching = e.touches.length !== 0;
                    }, false);

                    renderer.on('tick', this.tick.bind(this));
                }

                MouseViewController.prototype.tick = function tick(dt) {
                    if (this.first || this.moving || this.locked || this.touching) {
                        var target = this.target;

                        target.lookForward();
                        target.rotateY(-this.yaw);
                        vec3.set(buffer, dt / 200 * this.speed * this.sideways, 0, dt / 200 * this.speed * this.forward);
                        target.translateRelatively(buffer);
                        target.rotateX(-this.pitch);
                        target.rotateZ(-this.roll);

                        this.first = false;
                    }

                    // TODO: less ugly
                    //this.target.position[1] = this.getHeight(this.target);
                };

                return MouseViewController;
            })();

            _export('default', MouseViewController);
        }
    };
});
System.register('lib/extra/webgl-debug', ['npm:babel-runtime@5.4.3/core-js/object/keys'], function (_export) {
  var _Object$keys, log, error, glValidEnumContexts, glEnums, enumStringToValue;

  /**
   * Initializes this module. Safe to call more than once.
   * @param {!WebGLRenderingContext} ctx A WebGL context. If
   *    you have more than one context it doesn't matter which one
   *    you pass in, it is only used to pull out constants.
   */
  function init(ctx) {
    if (glEnums == null) {
      glEnums = {};
      enumStringToValue = {};
      for (var propertyName in ctx) {
        if (typeof ctx[propertyName] == 'number') {
          glEnums[ctx[propertyName]] = propertyName;
          enumStringToValue[propertyName] = ctx[propertyName];
        }
      }
    }
  }

  /**
   * Checks the utils have been initialized.
   */
  function checkInit() {
    if (glEnums == null) {
      throw 'WebGLDebugUtils.init(ctx) not called';
    }
  }

  /**
   * Returns true or false if value matches any WebGL enum
   * @param {*} value Value to check if it might be an enum.
   * @return {boolean} True if value matches one of the WebGL defined enums
   */
  function mightBeEnum(value) {
    checkInit();
    return glEnums[value] !== undefined;
  }

  /**
   * Gets an string version of an WebGL enum.
   *
   * Example:
   *   var str = WebGLDebugUtil.glEnumToString(ctx.getError());
   *
   * @param {number} value Value to return an enum for
   * @return {string} The string version of the enum.
   */
  function glEnumToString(value) {
    checkInit();
    var name = glEnums[value];
    return name !== undefined ? 'gl.' + name : '/*UNKNOWN WebGL ENUM*/ 0x' + value.toString(16) + '';
  }

  /**
   * Returns the string version of a WebGL argument.
   * Attempts to convert enum arguments to strings.
   * @param {string} functionName the name of the WebGL function.
   * @param {number} numArgs the number of arguments passed to the function.
   * @param {number} argumentIndx the index of the argument.
   * @param {*} value The value of the argument.
   * @return {string} The value as a string.
   */
  function glFunctionArgToString(functionName, numArgs, argumentIndex, value) {
    var funcInfo = glValidEnumContexts[functionName];
    if (funcInfo !== undefined) {
      var funcInfo = funcInfo[numArgs];
      if (funcInfo !== undefined) {
        if (funcInfo[argumentIndex]) {
          if (typeof funcInfo[argumentIndex] === 'object' && funcInfo[argumentIndex]['enumBitwiseOr'] !== undefined) {
            var enums = funcInfo[argumentIndex]['enumBitwiseOr'];
            var orResult = 0;
            var orEnums = [];
            for (var i = 0; i < enums.length; ++i) {
              var enumValue = enumStringToValue[enums[i]];
              if ((value & enumValue) !== 0) {
                orResult |= enumValue;
                orEnums.push(glEnumToString(enumValue));
              }
            }
            if (orResult === value) {
              return orEnums.join(' | ');
            } else {
              return glEnumToString(value);
            }
          } else {
            return glEnumToString(value);
          }
        }
      }
    }
    if (value === null) {
      return 'null';
    } else if (value === undefined) {
      return 'undefined';
    } else {
      return value.toString();
    }
  }

  /**
   * Converts the arguments of a WebGL function to a string.
   * Attempts to convert enum arguments to strings.
   *
   * @param {string} functionName the name of the WebGL function.
   * @param {number} args The arguments.
   * @return {string} The arguments as a string.
   */
  function glFunctionArgsToString(functionName, args) {
    // apparently we can't do args.join(",");
    var argStr = '';
    var numArgs = args.length;
    for (var ii = 0; ii < numArgs; ++ii) {
      argStr += (ii == 0 ? '' : ', ') + glFunctionArgToString(functionName, numArgs, ii, args[ii]);
    }
    return argStr;
  }

  function makePropertyWrapper(wrapper, original, propertyName) {
    //log("wrap prop: " + propertyName);
    wrapper.__defineGetter__(propertyName, function () {
      return original[propertyName];
    });
    // TODO(gmane): this needs to handle properties that take more than
    // one value?
    wrapper.__defineSetter__(propertyName, function (value) {
      //log("set: " + propertyName);
      original[propertyName] = value;
    });
  }

  // Makes a function that calls a function on another object.
  function makeFunctionWrapper(original, functionName) {
    //log("wrap fn: " + functionName);
    var f = original[functionName];
    return function () {
      //log("call: " + functionName);
      var result = f.apply(original, arguments);
      return result;
    };
  }

  /**
   * Given a WebGL context returns a wrapped context that calls
   * gl.getError after every command and calls a function if the
   * result is not gl.NO_ERROR.
   *
   * @param {!WebGLRenderingContext} ctx The webgl context to
   *        wrap.
   * @param {!function(err, funcName, args): void} opt_onErrorFunc
   *        The function to call when gl.getError returns an
   *        error. If not specified the default function calls
   *        console.log with a message.
   * @param {!function(funcName, args): void} opt_onFunc The
   *        function to call when each webgl function is called.
   *        You can use this to log all calls for example.
   * @param {!WebGLRenderingContext} opt_err_ctx The webgl context
   *        to call getError on if different than ctx.
   */
  function makeDebugContext(ctx, opt_onErrorFunc, opt_onFunc, opt_err_ctx) {
    opt_err_ctx = opt_err_ctx || ctx;
    init(ctx);
    opt_onErrorFunc = opt_onErrorFunc || function (err, functionName, args) {
      // apparently we can't do args.join(",");
      var argStr = '';
      var numArgs = args.length;
      for (var ii = 0; ii < numArgs; ++ii) {
        argStr += (ii == 0 ? '' : ', ') + glFunctionArgToString(functionName, numArgs, ii, args[ii]);
      }
      error('WebGL error ' + glEnumToString(err) + ' in ' + functionName + '(' + argStr + ')');
    };

    // Holds booleans for each GL error so after we get the error ourselves
    // we can still return it to the client app.
    var glErrorShadow = {};

    // Makes a function that calls a WebGL function and then calls getError.
    function makeErrorWrapper(ctx, functionName) {
      return function () {
        if (opt_onFunc) {
          opt_onFunc(functionName, arguments);
        }
        var result = ctx[functionName].apply(ctx, arguments);
        var err = opt_err_ctx.getError();
        if (err != 0) {
          glErrorShadow[err] = true;
          opt_onErrorFunc(err, functionName, arguments);
        }
        return result;
      };
    }

    // Make a an object that has a copy of every property of the WebGL context
    // but wraps all functions.
    var wrapper = {};
    for (var propertyName in ctx) {
      if (typeof ctx[propertyName] == 'function') {
        if (propertyName != 'getExtension') {
          wrapper[propertyName] = makeErrorWrapper(ctx, propertyName);
        } else {
          var wrapped = makeErrorWrapper(ctx, propertyName);
          wrapper[propertyName] = function () {
            var result = wrapped.apply(ctx, arguments);
            return makeDebugContext(result, opt_onErrorFunc, opt_onFunc, opt_err_ctx);
          };
        }
      } else {
        makePropertyWrapper(wrapper, ctx, propertyName);
      }
    }

    // Override the getError function with one that returns our saved results.
    wrapper.getError = function () {
      for (var err in glErrorShadow) {
        if (glErrorShadow.hasOwnProperty(err)) {
          if (glErrorShadow[err]) {
            glErrorShadow[err] = false;
            return err;
          }
        }
      }
      return ctx.NO_ERROR;
    };

    return wrapper;
  }

  function resetToInitialState(ctx) {
    var numAttribs = ctx.getParameter(ctx.MAX_VERTEX_ATTRIBS);
    var tmp = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, tmp);
    for (var ii = 0; ii < numAttribs; ++ii) {
      ctx.disableVertexAttribArray(ii);
      ctx.vertexAttribPointer(ii, 4, ctx.FLOAT, false, 0, 0);
      ctx.vertexAttrib1f(ii, 0);
    }
    ctx.deleteBuffer(tmp);

    var numTextureUnits = ctx.getParameter(ctx.MAX_TEXTURE_IMAGE_UNITS);
    for (var ii = 0; ii < numTextureUnits; ++ii) {
      ctx.activeTexture(ctx.TEXTURE0 + ii);
      ctx.bindTexture(ctx.TEXTURE_CUBE_MAP, null);
      ctx.bindTexture(ctx.TEXTURE_2D, null);
    }

    ctx.activeTexture(ctx.TEXTURE0);
    ctx.useProgram(null);
    ctx.bindBuffer(ctx.ARRAY_BUFFER, null);
    ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, null);
    ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
    ctx.bindRenderbuffer(ctx.RENDERBUFFER, null);
    ctx.disable(ctx.BLEND);
    ctx.disable(ctx.CULL_FACE);
    ctx.disable(ctx.DEPTH_TEST);
    ctx.disable(ctx.DITHER);
    ctx.disable(ctx.SCISSOR_TEST);
    ctx.blendColor(0, 0, 0, 0);
    ctx.blendEquation(ctx.FUNC_ADD);
    ctx.blendFunc(ctx.ONE, ctx.ZERO);
    ctx.clearColor(0, 0, 0, 0);
    ctx.clearDepth(1);
    ctx.clearStencil(-1);
    ctx.colorMask(true, true, true, true);
    ctx.cullFace(ctx.BACK);
    ctx.depthFunc(ctx.LESS);
    ctx.depthMask(true);
    ctx.depthRange(0, 1);
    ctx.frontFace(ctx.CCW);
    ctx.hint(ctx.GENERATE_MIPMAP_HINT, ctx.DONT_CARE);
    ctx.lineWidth(1);
    ctx.pixelStorei(ctx.PACK_ALIGNMENT, 4);
    ctx.pixelStorei(ctx.UNPACK_ALIGNMENT, 4);
    ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, false);
    ctx.pixelStorei(ctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // TODO: Delete this IF.
    if (ctx.UNPACK_COLORSPACE_CONVERSION_WEBGL) {
      ctx.pixelStorei(ctx.UNPACK_COLORSPACE_CONVERSION_WEBGL, ctx.BROWSER_DEFAULT_WEBGL);
    }
    ctx.polygonOffset(0, 0);
    ctx.sampleCoverage(1, false);
    ctx.scissor(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.stencilFunc(ctx.ALWAYS, 0, 4294967295);
    ctx.stencilMask(4294967295);
    ctx.stencilOp(ctx.KEEP, ctx.KEEP, ctx.KEEP);
    ctx.viewport(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.clear(ctx.COLOR_BUFFER_BIT | ctx.DEPTH_BUFFER_BIT | ctx.STENCIL_BUFFER_BIT);

    // TODO: This should NOT be needed but Firefox fails with 'hint'
    while (ctx.getError());
  }

  function makeLostContextSimulatingCanvas(canvas) {
    var unwrappedContext_;
    var wrappedContext_;
    var onLost_ = [];
    var onRestored_ = [];
    var wrappedContext_ = {};
    var contextId_ = 1;
    var contextLost_ = false;
    var resourceId_ = 0;
    var resourceDb_ = [];
    var numCallsToLoseContext_ = 0;
    var numCalls_ = 0;
    var canRestore_ = false;
    var restoreTimeout_ = 0;

    // Holds booleans for each GL error so can simulate errors.
    var glErrorShadow_ = {};

    canvas.getContext = (function (f) {
      return function () {
        var ctx = f.apply(canvas, arguments);
        // Did we get a context and is it a WebGL context?
        if (ctx instanceof WebGLRenderingContext) {
          if (ctx != unwrappedContext_) {
            if (unwrappedContext_) {
              throw 'got different context';
            }
            unwrappedContext_ = ctx;
            wrappedContext_ = makeLostContextSimulatingContext(unwrappedContext_);
          }
          return wrappedContext_;
        }
        return ctx;
      };
    })(canvas.getContext);

    function wrapEvent(listener) {
      if (typeof listener == 'function') {
        return listener;
      } else {
        return function (info) {
          listener.handleEvent(info);
        };
      }
    }

    var addOnContextLostListener = function addOnContextLostListener(listener) {
      onLost_.push(wrapEvent(listener));
    };

    var addOnContextRestoredListener = function addOnContextRestoredListener(listener) {
      onRestored_.push(wrapEvent(listener));
    };

    function wrapAddEventListener(canvas) {
      var f = canvas.addEventListener;
      canvas.addEventListener = function (type, listener, bubble) {
        switch (type) {
          case 'webglcontextlost':
            addOnContextLostListener(listener);
            break;
          case 'webglcontextrestored':
            addOnContextRestoredListener(listener);
            break;
          default:
            f.apply(canvas, arguments);
        }
      };
    }

    wrapAddEventListener(canvas);

    canvas.loseContext = function () {
      if (!contextLost_) {
        contextLost_ = true;
        numCallsToLoseContext_ = 0;
        ++contextId_;
        while (unwrappedContext_.getError());
        clearErrors();
        glErrorShadow_[unwrappedContext_.CONTEXT_LOST_WEBGL] = true;
        var event = makeWebGLContextEvent('context lost');
        var callbacks = onLost_.slice();
        setTimeout(function () {
          //log("numCallbacks:" + callbacks.length);
          for (var ii = 0; ii < callbacks.length; ++ii) {
            //log("calling callback:" + ii);
            callbacks[ii](event);
          }
          if (restoreTimeout_ >= 0) {
            setTimeout(function () {
              canvas.restoreContext();
            }, restoreTimeout_);
          }
        }, 0);
      }
    };

    canvas.restoreContext = function () {
      if (contextLost_) {
        if (onRestored_.length) {
          setTimeout(function () {
            if (!canRestore_) {
              throw 'can not restore. webglcontestlost listener did not call event.preventDefault';
            }
            freeResources();
            resetToInitialState(unwrappedContext_);
            contextLost_ = false;
            numCalls_ = 0;
            canRestore_ = false;
            var callbacks = onRestored_.slice();
            var event = makeWebGLContextEvent('context restored');
            for (var ii = 0; ii < callbacks.length; ++ii) {
              callbacks[ii](event);
            }
          }, 0);
        }
      }
    };

    canvas.loseContextInNCalls = function (numCalls) {
      if (contextLost_) {
        throw 'You can not ask a lost contet to be lost';
      }
      numCallsToLoseContext_ = numCalls_ + numCalls;
    };

    canvas.getNumCalls = function () {
      return numCalls_;
    };

    canvas.setRestoreTimeout = function (timeout) {
      restoreTimeout_ = timeout;
    };

    function isWebGLObject(obj) {
      //return false;
      return obj instanceof WebGLBuffer || obj instanceof WebGLFramebuffer || obj instanceof WebGLProgram || obj instanceof WebGLRenderbuffer || obj instanceof WebGLShader || obj instanceof WebGLTexture;
    }

    function checkResources(args) {
      for (var ii = 0; ii < args.length; ++ii) {
        var arg = args[ii];
        if (isWebGLObject(arg)) {
          return arg.__webglDebugContextLostId__ == contextId_;
        }
      }
      return true;
    }

    function clearErrors() {
      var k = _Object$keys(glErrorShadow_);
      for (var ii = 0; ii < k.length; ++ii) {
        delete glErrorShadow_[k];
      }
    }

    function loseContextIfTime() {
      ++numCalls_;
      if (!contextLost_) {
        if (numCallsToLoseContext_ == numCalls_) {
          canvas.loseContext();
        }
      }
    }

    // Makes a function that simulates WebGL when out of context.
    function makeLostContextFunctionWrapper(ctx, functionName) {
      var f = ctx[functionName];
      return function () {
        // log("calling:" + functionName);
        // Only call the functions if the context is not lost.
        loseContextIfTime();
        if (!contextLost_) {
          //if (!checkResources(arguments)) {
          //  glErrorShadow_[wrappedContext_.INVALID_OPERATION] = true;
          //  return;
          //}
          var result = f.apply(ctx, arguments);
          return result;
        }
      };
    }

    function freeResources() {
      for (var ii = 0; ii < resourceDb_.length; ++ii) {
        var resource = resourceDb_[ii];
        if (resource instanceof WebGLBuffer) {
          unwrappedContext_.deleteBuffer(resource);
        } else if (resource instanceof WebGLFramebuffer) {
          unwrappedContext_.deleteFramebuffer(resource);
        } else if (resource instanceof WebGLProgram) {
          unwrappedContext_.deleteProgram(resource);
        } else if (resource instanceof WebGLRenderbuffer) {
          unwrappedContext_.deleteRenderbuffer(resource);
        } else if (resource instanceof WebGLShader) {
          unwrappedContext_.deleteShader(resource);
        } else if (resource instanceof WebGLTexture) {
          unwrappedContext_.deleteTexture(resource);
        }
      }
    }

    function makeWebGLContextEvent(statusMessage) {
      return {
        statusMessage: statusMessage,
        preventDefault: function preventDefault() {
          canRestore_ = true;
        }
      };
    }

    return canvas;

    function makeLostContextSimulatingContext(ctx) {
      // copy all functions and properties to wrapper
      for (var propertyName in ctx) {
        if (typeof ctx[propertyName] == 'function') {
          wrappedContext_[propertyName] = makeLostContextFunctionWrapper(ctx, propertyName);
        } else {
          makePropertyWrapper(wrappedContext_, ctx, propertyName);
        }
      }

      // Wrap a few functions specially.
      wrappedContext_.getError = function () {
        loseContextIfTime();
        if (!contextLost_) {
          var err;
          while (err = unwrappedContext_.getError()) {
            glErrorShadow_[err] = true;
          }
        }
        for (var err in glErrorShadow_) {
          if (glErrorShadow_[err]) {
            delete glErrorShadow_[err];
            return err;
          }
        }
        return wrappedContext_.NO_ERROR;
      };

      var creationFunctions = ['createBuffer', 'createFramebuffer', 'createProgram', 'createRenderbuffer', 'createShader', 'createTexture'];
      for (var ii = 0; ii < creationFunctions.length; ++ii) {
        var functionName = creationFunctions[ii];
        wrappedContext_[functionName] = (function (f) {
          return function () {
            loseContextIfTime();
            if (contextLost_) {
              return null;
            }
            var obj = f.apply(ctx, arguments);
            obj.__webglDebugContextLostId__ = contextId_;
            resourceDb_.push(obj);
            return obj;
          };
        })(ctx[functionName]);
      }

      var functionsThatShouldReturnNull = ['getActiveAttrib', 'getActiveUniform', 'getBufferParameter', 'getContextAttributes', 'getAttachedShaders', 'getFramebufferAttachmentParameter', 'getParameter', 'getProgramParameter', 'getProgramInfoLog', 'getRenderbufferParameter', 'getShaderParameter', 'getShaderInfoLog', 'getShaderSource', 'getTexParameter', 'getUniform', 'getUniformLocation', 'getVertexAttrib'];
      for (var ii = 0; ii < functionsThatShouldReturnNull.length; ++ii) {
        var functionName = functionsThatShouldReturnNull[ii];
        wrappedContext_[functionName] = (function (f) {
          return function () {
            loseContextIfTime();
            if (contextLost_) {
              return null;
            }
            return f.apply(ctx, arguments);
          };
        })(wrappedContext_[functionName]);
      }

      var isFunctions = ['isBuffer', 'isEnabled', 'isFramebuffer', 'isProgram', 'isRenderbuffer', 'isShader', 'isTexture'];
      for (var ii = 0; ii < isFunctions.length; ++ii) {
        var functionName = isFunctions[ii];
        wrappedContext_[functionName] = (function (f) {
          return function () {
            loseContextIfTime();
            if (contextLost_) {
              return false;
            }
            return f.apply(ctx, arguments);
          };
        })(wrappedContext_[functionName]);
      }

      wrappedContext_.checkFramebufferStatus = (function (f) {
        return function () {
          loseContextIfTime();
          if (contextLost_) {
            return wrappedContext_.FRAMEBUFFER_UNSUPPORTED;
          }
          return f.apply(ctx, arguments);
        };
      })(wrappedContext_.checkFramebufferStatus);

      wrappedContext_.getAttribLocation = (function (f) {
        return function () {
          loseContextIfTime();
          if (contextLost_) {
            return -1;
          }
          return f.apply(ctx, arguments);
        };
      })(wrappedContext_.getAttribLocation);

      wrappedContext_.getVertexAttribOffset = (function (f) {
        return function () {
          loseContextIfTime();
          if (contextLost_) {
            return 0;
          }
          return f.apply(ctx, arguments);
        };
      })(wrappedContext_.getVertexAttribOffset);

      wrappedContext_.isContextLost = function () {
        return contextLost_;
      };

      return wrappedContext_;
    }
  }

  return {
    setters: [function (_npmBabelRuntime543CoreJsObjectKeys) {
      _Object$keys = _npmBabelRuntime543CoreJsObjectKeys['default'];
    }],
    execute: function () {
      /*
      ** Copyright (c) 2012 The Khronos Group Inc.
      **
      ** Permission is hereby granted, free of charge, to any person obtaining a
      ** copy of this software and/or associated documentation files (the
      ** "Materials"), to deal in the Materials without restriction, including
      ** without limitation the rights to use, copy, modify, merge, publish,
      ** distribute, sublicense, and/or sell copies of the Materials, and to
      ** permit persons to whom the Materials are furnished to do so, subject to
      ** the following conditions:
      **
      ** The above copyright notice and this permission notice shall be included
      ** in all copies or substantial portions of the Materials.
      **
      ** THE MATERIALS ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
      ** EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
      ** MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
      ** IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
      ** CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
      ** TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
      ** MATERIALS OR THE USE OR OTHER DEALINGS IN THE MATERIALS.
      */

      // Various functions for helping debug WebGL apps.

      /**
       * Wrapped logging function.
       * @param {string} msg Message to log.
       */
      'use strict';

      log = function log(msg) {
        if (window.console && window.console.log) {
          window.console.log(msg);
        }
      };

      /**
       * Wrapped error logging function.
       * @param {string} msg Message to log.
       */

      error = function error(msg) {
        if (window.console && window.console.error) {
          window.console.error(msg);
        } else {
          log(msg);
        }
      };

      /**
       * Which arguments are enums based on the number of arguments to the function.
       * So
       *    'texImage2D': {
       *       9: { 0:true, 2:true, 6:true, 7:true },
       *       6: { 0:true, 2:true, 3:true, 4:true },
       *    },
       *
       * means if there are 9 arguments then 6 and 7 are enums, if there are 6
       * arguments 3 and 4 are enums
       *
       * @type {!Object.<number, !Object.<number, string>}
       */
      glValidEnumContexts = {
        // Generic setters and getters

        'enable': { 1: { 0: true } },
        'disable': { 1: { 0: true } },
        'getParameter': { 1: { 0: true } },

        // Rendering

        'drawArrays': { 3: { 0: true } },
        'drawElements': { 4: { 0: true, 2: true } },

        // Shaders

        'createShader': { 1: { 0: true } },
        'getShaderParameter': { 2: { 1: true } },
        'getProgramParameter': { 2: { 1: true } },
        'getShaderPrecisionFormat': { 2: { 0: true, 1: true } },

        // Vertex attributes

        'getVertexAttrib': { 2: { 1: true } },
        'vertexAttribPointer': { 6: { 2: true } },

        // Textures

        'bindTexture': { 2: { 0: true } },
        'activeTexture': { 1: { 0: true } },
        'getTexParameter': { 2: { 0: true, 1: true } },
        'texParameterf': { 3: { 0: true, 1: true } },
        'texParameteri': { 3: { 0: true, 1: true, 2: true } },
        'texImage2D': {
          9: { 0: true, 2: true, 6: true, 7: true },
          6: { 0: true, 2: true, 3: true, 4: true }
        },
        'texSubImage2D': {
          9: { 0: true, 6: true, 7: true },
          7: { 0: true, 4: true, 5: true }
        },
        'copyTexImage2D': { 8: { 0: true, 2: true } },
        'copyTexSubImage2D': { 8: { 0: true } },
        'generateMipmap': { 1: { 0: true } },
        'compressedTexImage2D': { 7: { 0: true, 2: true } },
        'compressedTexSubImage2D': { 8: { 0: true, 6: true } },

        // Buffer objects

        'bindBuffer': { 2: { 0: true } },
        'bufferData': { 3: { 0: true, 2: true } },
        'bufferSubData': { 3: { 0: true } },
        'getBufferParameter': { 2: { 0: true, 1: true } },

        // Renderbuffers and framebuffers

        'pixelStorei': { 2: { 0: true, 1: true } },
        'readPixels': { 7: { 4: true, 5: true } },
        'bindRenderbuffer': { 2: { 0: true } },
        'bindFramebuffer': { 2: { 0: true } },
        'checkFramebufferStatus': { 1: { 0: true } },
        'framebufferRenderbuffer': { 4: { 0: true, 1: true, 2: true } },
        'framebufferTexture2D': { 5: { 0: true, 1: true, 2: true } },
        'getFramebufferAttachmentParameter': { 3: { 0: true, 1: true, 2: true } },
        'getRenderbufferParameter': { 2: { 0: true, 1: true } },
        'renderbufferStorage': { 4: { 0: true, 1: true } },

        // Frame buffer operations (clear, blend, depth test, stencil)

        'clear': { 1: { 0: { 'enumBitwiseOr': ['COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'STENCIL_BUFFER_BIT'] } } },
        'depthFunc': { 1: { 0: true } },
        'blendFunc': { 2: { 0: true, 1: true } },
        'blendFuncSeparate': { 4: { 0: true, 1: true, 2: true, 3: true } },
        'blendEquation': { 1: { 0: true } },
        'blendEquationSeparate': { 2: { 0: true, 1: true } },
        'stencilFunc': { 3: { 0: true } },
        'stencilFuncSeparate': { 4: { 0: true, 1: true } },
        'stencilMaskSeparate': { 2: { 0: true } },
        'stencilOp': { 3: { 0: true, 1: true, 2: true } },
        'stencilOpSeparate': { 4: { 0: true, 1: true, 2: true, 3: true } },

        // Culling

        'cullFace': { 1: { 0: true } },
        'frontFace': { 1: { 0: true } },

        // ANGLE_instanced_arrays extension

        'drawArraysInstancedANGLE': { 4: { 0: true } },
        'drawElementsInstancedANGLE': { 5: { 0: true, 2: true } },

        // EXT_blend_minmax extension

        'blendEquationEXT': { 1: { 0: true } }
      };

      /**
       * Map of numbers to names.
       * @type {Object}
       */
      glEnums = null;

      /**
       * Map of names to numbers.
       * @type {Object}
       */
      enumStringToValue = null;
      ;
      _export('default', {
        /**
         * Initializes this module. Safe to call more than once.
         * @param {!WebGLRenderingContext} ctx A WebGL context. If
         *    you have more than one context it doesn't matter which one
         *    you pass in, it is only used to pull out constants.
         */
        'init': init,

        /**
         * Returns true or false if value matches any WebGL enum
         * @param {*} value Value to check if it might be an enum.
         * @return {boolean} True if value matches one of the WebGL defined enums
         */
        'mightBeEnum': mightBeEnum,

        /**
         * Gets an string version of an WebGL enum.
         *
         * Example:
         *   WebGLDebugUtil.init(ctx);
         *   var str = WebGLDebugUtil.glEnumToString(ctx.getError());
         *
         * @param {number} value Value to return an enum for
         * @return {string} The string version of the enum.
         */
        'glEnumToString': glEnumToString,

        /**
         * Converts the argument of a WebGL function to a string.
         * Attempts to convert enum arguments to strings.
         *
         * Example:
         *   WebGLDebugUtil.init(ctx);
         *   var str = WebGLDebugUtil.glFunctionArgToString('bindTexture', 2, 0, gl.TEXTURE_2D);
         *
         * would return 'TEXTURE_2D'
         *
         * @param {string} functionName the name of the WebGL function.
         * @param {number} numArgs The number of arguments
         * @param {number} argumentIndx the index of the argument.
         * @param {*} value The value of the argument.
         * @return {string} The value as a string.
         */
        'glFunctionArgToString': glFunctionArgToString,

        /**
         * Converts the arguments of a WebGL function to a string.
         * Attempts to convert enum arguments to strings.
         *
         * @param {string} functionName the name of the WebGL function.
         * @param {number} args The arguments.
         * @return {string} The arguments as a string.
         */
        'glFunctionArgsToString': glFunctionArgsToString,

        /**
         * Given a WebGL context returns a wrapped context that calls
         * gl.getError after every command and calls a function if the
         * result is not NO_ERROR.
         *
         * You can supply your own function if you want. For example, if you'd like
         * an exception thrown on any GL error you could do this
         *
         *    function throwOnGLError(err, funcName, args) {
         *      throw WebGLDebugUtils.glEnumToString(err) +
         *            " was caused by call to " + funcName;
         *    };
         *
         *    ctx = WebGLDebugUtils.makeDebugContext(
         *        canvas.getContext("webgl"), throwOnGLError);
         *
         * @param {!WebGLRenderingContext} ctx The webgl context to wrap.
         * @param {!function(err, funcName, args): void} opt_onErrorFunc The function
         *     to call when gl.getError returns an error. If not specified the default
         *     function calls console.log with a message.
         * @param {!function(funcName, args): void} opt_onFunc The
         *     function to call when each webgl function is called. You
         *     can use this to log all calls for example.
         */
        'makeDebugContext': makeDebugContext,

        /**
         * Given a canvas element returns a wrapped canvas element that will
         * simulate lost context. The canvas returned adds the following functions.
         *
         * loseContext:
         *   simulates a lost context event.
         *
         * restoreContext:
         *   simulates the context being restored.
         *
         * lostContextInNCalls:
         *   loses the context after N gl calls.
         *
         * getNumCalls:
         *   tells you how many gl calls there have been so far.
         *
         * setRestoreTimeout:
         *   sets the number of milliseconds until the context is restored
         *   after it has been lost. Defaults to 0. Pass -1 to prevent
         *   automatic restoring.
         *
         * @param {!Canvas} canvas The canvas element to wrap.
         */
        'makeLostContextSimulatingCanvas': makeLostContextSimulatingCanvas,

        /**
         * Resets a context to the initial state.
         * @param {!WebGLRenderingContext} ctx The webgl context to
         *     reset.
         */
        'resetToInitialState': resetToInitialState
      });
    }
  };
});
System.register('lib/extra/bounding-box', ['npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/array/from'], function (_export) {
    var _classCallCheck, _Array$from, initialIntervals, BoundingBox;

    return {
        setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsArrayFrom) {
            _Array$from = _npmBabelRuntime543CoreJsArrayFrom['default'];
        }],
        execute: function () {
            'use strict';

            initialIntervals = new Float64Array([Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);

            BoundingBox = (function () {
                function BoundingBox() {
                    _classCallCheck(this, BoundingBox);

                    this.points = new Float64Array(24);

                    // (x-min, x-max, y-min, y-max, z-min, z-max)
                    this.intervals = new Float64Array(6);

                    // (x-mid, y-mid, z-mid)
                    this.center = new Float64Array(3);
                }

                BoundingBox.prototype.toString = function toString() {
                    return '(' + _Array$from(this.intervals, function (n) {
                        return n.toFixed(2);
                    }).join(', ') + ')';
                };

                BoundingBox.prototype.resetIntervals = function resetIntervals() {
                    this.intervals.set(initialIntervals);
                };

                BoundingBox.prototype.expandIntervals = function expandIntervals(points) {
                    var stride = arguments[1] === undefined ? 3 : arguments[1];

                    var intervals = this.intervals;

                    for (var offset = 0, len = points.length; offset < len; offset += stride) {
                        var x = points[offset],
                            y = points[offset + 1],
                            z = points[offset + 2];
                        if (x < intervals[0]) intervals[0] = x;else if (x > intervals[1]) intervals[1] = x;
                        if (y < intervals[2]) intervals[2] = y;else if (y > intervals[3]) intervals[3] = y;
                        if (z < intervals[4]) intervals[4] = z;else if (z > intervals[5]) intervals[5] = z;
                    }
                };

                BoundingBox.prototype.expandFromIntervals = function expandFromIntervals(otherIntervals) {
                    var intervals = this.intervals;

                    if (otherIntervals[0] < intervals[0]) intervals[0] = otherIntervals[0];
                    if (otherIntervals[1] > intervals[1]) intervals[1] = otherIntervals[1];
                    if (otherIntervals[2] < intervals[2]) intervals[2] = otherIntervals[2];
                    if (otherIntervals[3] > intervals[3]) intervals[3] = otherIntervals[3];
                    if (otherIntervals[4] < intervals[4]) intervals[4] = otherIntervals[4];
                    if (otherIntervals[5] > intervals[5]) intervals[5] = otherIntervals[5];
                };

                BoundingBox.prototype.computePoints = function computePoints() {
                    var points = this.points;
                    var center = this.center;
                    var intervals = this.intervals;

                    points[0] = intervals[0];points[1] = intervals[2];points[2] = intervals[4]; // (x-min, y-min, z-min)
                    points[3] = intervals[0];points[4] = intervals[2];points[5] = intervals[5]; // (x-min, y-min, z-max)
                    points[6] = intervals[0];points[7] = intervals[3];points[8] = intervals[4]; // (x-min, y-max, z-min)
                    points[9] = intervals[0];points[10] = intervals[3];points[11] = intervals[5]; // (x-min, y-max, z-max)
                    points[12] = intervals[1];points[13] = intervals[2];points[14] = intervals[4]; // (x-max, y-min, z-min)
                    points[15] = intervals[1];points[16] = intervals[2];points[17] = intervals[5]; // (x-max, y-min, z-max)
                    points[18] = intervals[1];points[19] = intervals[3];points[20] = intervals[4]; // (x-max, y-max, z-min)
                    points[21] = intervals[1];points[22] = intervals[3];points[23] = intervals[5]; // (x-max, y-max, z-max)

                    center[0] = (intervals[0] + intervals[1]) / 2;
                    center[1] = (intervals[2] + intervals[3]) / 2;
                    center[2] = (intervals[4] + intervals[5]) / 2;
                };

                return BoundingBox;
            })();

            _export('default', BoundingBox);
        }
    };
});
System.register('lib/texture/texture2d', ['npm:babel-runtime@5.4.3/helpers/create-class', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'lib/texture/common'], function (_export) {
    var _createClass, _classCallCheck, resizeImageData, getImage, MAX_SIZE, Texture2D;

    return {
        setters: [function (_npmBabelRuntime543HelpersCreateClass) {
            _createClass = _npmBabelRuntime543HelpersCreateClass['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_libTextureCommon) {
            resizeImageData = _libTextureCommon.resizeImageData;
            getImage = _libTextureCommon.getImage;
        }],
        execute: function () {
            'use strict';

            MAX_SIZE = (function () {
                var canvas = document.createElement('canvas');
                var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                return gl.getParameter(gl.MAX_TEXTURE_SIZE);
            })();

            Texture2D = (function () {
                function Texture2D(imageData) {
                    _classCallCheck(this, Texture2D);

                    this.imageData = imageData;
                }

                Texture2D.fromFile = function fromFile(filename, format) {
                    return getImage(filename, format).then(function (imageData) {

                        // Shrink image if any dimension is bigger than the maxiumum size
                        // Aspect ratio does not need to be preserved, since texture coordinate are relative
                        if (imageData.height > MAX_SIZE || imageData.width > MAX_SIZE) {
                            imageData = resizeImageData(imageData, Math.min(MAX_SIZE, imageData.width), Math.min(MAX_SIZE, imageData.height));
                        }

                        return new Texture2D(imageData);
                    });
                };

                _createClass(Texture2D, [{
                    key: 'width',
                    get: function () {
                        return this.imageData.width;
                    }
                }, {
                    key: 'height',
                    get: function () {
                        return this.imageData.height;
                    }
                }]);

                return Texture2D;
            })();

            _export('default', Texture2D);
        }
    };
});
System.register("lib/extra/event-aggregator", ["npm:babel-runtime@5.4.3/helpers/create-class", "npm:babel-runtime@5.4.3/helpers/class-call-check", "npm:babel-runtime@5.4.3/core-js/map", "npm:babel-runtime@5.4.3/core-js/set", "npm:babel-runtime@5.4.3/core-js/get-iterator", "npm:babel-runtime@5.4.3/core-js/weak-map"], function (_export) {
    var _createClass, _classCallCheck, _Map, _Set, _getIterator, _WeakMap, debug, EventAggregator;

    return {
        setters: [function (_npmBabelRuntime543HelpersCreateClass) {
            _createClass = _npmBabelRuntime543HelpersCreateClass["default"];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck["default"];
        }, function (_npmBabelRuntime543CoreJsMap) {
            _Map = _npmBabelRuntime543CoreJsMap["default"];
        }, function (_npmBabelRuntime543CoreJsSet) {
            _Set = _npmBabelRuntime543CoreJsSet["default"];
        }, function (_npmBabelRuntime543CoreJsGetIterator) {
            _getIterator = _npmBabelRuntime543CoreJsGetIterator["default"];
        }, function (_npmBabelRuntime543CoreJsWeakMap) {
            _WeakMap = _npmBabelRuntime543CoreJsWeakMap["default"];
        }],
        execute: function () {
            "use strict";

            debug = true;

            EventAggregator = (function () {
                function EventAggregator() {
                    var bubbleTarget = arguments[0] === undefined ? null : arguments[0];

                    _classCallCheck(this, EventAggregator);

                    EventAggregator.privates.set(this, { callbacks: new _Map(), buffers: new _Map(), bubbleTarget: bubbleTarget });
                }

                EventAggregator.prototype.on = function on(event) {
                    var callback = arguments[1] === undefined ? null : arguments[1];

                    if (!this._callbacks.has(event)) this._callbacks.set(event, new _Set());

                    if (debug) console.log("" + this.constructor.name + " bound handler to: " + event);

                    // Add callback
                    this._callbacks.get(event).add(callback);

                    var buffer = this._buffers.get(event);
                    if (buffer !== undefined) {
                        for (var _iterator = buffer, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _getIterator(_iterator);;) {
                            var _ref;

                            if (_isArray) {
                                if (_i >= _iterator.length) break;
                                _ref = _iterator[_i++];
                            } else {
                                _i = _iterator.next();
                                if (_i.done) break;
                                _ref = _i.value;
                            }

                            var args = _ref.args;
                            var options = _ref.options;

                            this.trigger.apply(this, [event, options].concat(args));
                            if (debug) console.log("" + this.constructor.name + " released: " + event);
                        }
                        this._buffers["delete"](event);
                    }
                };

                EventAggregator.prototype.off = function off(event) {
                    var callback = arguments[1] === undefined ? null : arguments[1];

                    if (this._callbacks.has(event)) {
                        if (callback === null) this._callbacks["delete"](event);

                        this._callbacks.get(event)["delete"](callback);

                        if (this._callbacks.get(event).size === 0) this._callbacks["delete"](event);
                    }
                };

                EventAggregator.prototype.once = function once(event, callback) {
                    var _this = this;

                    var cb = function cb() {
                        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                            args[_key] = arguments[_key];
                        }

                        callback.apply(undefined, args);
                        _this.off(event, cb);
                    };
                    this.on(event, cb);
                };

                EventAggregator.prototype.trigger = function trigger(event) {
                    for (var _len2 = arguments.length, args = Array(_len2 > 2 ? _len2 - 2 : 0), _key2 = 2; _key2 < _len2; _key2++) {
                        args[_key2 - 2] = arguments[_key2];
                    }

                    var options = arguments[1] === undefined ? {} : arguments[1];
                    var _options$bubble = options.bubble;
                    var bubble = _options$bubble === undefined ? false : _options$bubble;
                    var _options$buffer = options.buffer;
                    var buffer = _options$buffer === undefined ? false : _options$buffer;
                    var _options$sync = options.sync;
                    var sync = _options$sync === undefined ? false : _options$sync;
                    var _options$target = options.target;
                    var target = _options$target === undefined ? this : _options$target;
                    var _options$delay = options.delay;
                    var delay = _options$delay === undefined ? 0 : _options$delay;

                    if (this._callbacks.has(event)) {
                        var _loop = function () {
                            if (_isArray2) {
                                if (_i2 >= _iterator2.length) return "break";
                                _ref2 = _iterator2[_i2++];
                            } else {
                                _i2 = _iterator2.next();
                                if (_i2.done) return "break";
                                _ref2 = _i2.value;
                            }

                            var handler = _ref2;

                            if (sync) {
                                handler.apply(undefined, args.concat([target]));
                            } else {
                                window.setTimeout(function () {
                                    return handler.apply(undefined, args.concat([target]));
                                }, delay);
                            }
                        };

                        for (var _iterator2 = this._callbacks.get(event), _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _getIterator(_iterator2);;) {
                            var _ref2;

                            var _ret = _loop();

                            if (_ret === "break") break;
                        }
                    } else if (bubble && EventAggregator.privates.get(this).bubbleTarget !== null) {
                        var _EventAggregator$privates$get$bubbleTarget;

                        (_EventAggregator$privates$get$bubbleTarget = EventAggregator.privates.get(this).bubbleTarget).trigger.apply(_EventAggregator$privates$get$bubbleTarget, [event, options].concat(args));
                    } else if (buffer) {
                        if (!this._buffers.has(event)) {
                            this._buffers.set(event, []);
                        }
                        this._buffers.get(event).push({ args: args, options: options });
                    }
                };

                _createClass(EventAggregator, [{
                    key: "_callbacks",
                    get: function () {
                        return EventAggregator.privates.get(this).callbacks || (EventAggregator.privates.get(this).callbacks = new _Map());
                    }
                }, {
                    key: "_buffers",
                    get: function () {
                        return EventAggregator.privates.get(this).buffers || (EventAggregator.privates.get(this).buffers = new _Map());
                    }
                }], [{
                    key: "privates",
                    value: new _WeakMap(),
                    enumerable: true
                }]);

                return EventAggregator;
            })();

            _export("default", EventAggregator);
        }
    };
});
System.register('lib/material/phong', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/create-class', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/get-iterator', 'npm:babel-runtime@5.4.3/core-js/object/assign', 'npm:babel-runtime@5.4.3/core-js/math/log2', 'npm:babel-runtime@5.4.3/core-js/map', 'npm:babel-runtime@5.4.3/core-js/set', 'github:toji/gl-matrix@master', 'npm:memoizee@0.3.8', 'lib/extra/atlas', 'lib/material/base', 'lib/texture/texture2d', 'lib/extra/functional', 'lib/light/directional-light', 'lib/light/pointlight', 'lib/light/spotlight', 'lib/webgl/program', 'lib/webgl/shader', 'lib/material/shaders/phong.vert.dot!lib/plugins/dot', 'lib/material/shaders/phong.frag.dot!lib/plugins/dot', 'lib/extra/color', 'lib/texture/common'], function (_export) {
    var _inherits, _createClass, _classCallCheck, _getIterator, _Object$assign, _Math$log2, _Map, _Set, glm, memoize, Atlas, Region, Material, MaterialRenderer, Texture2D, construct, delegate, DirectionalLight, PointLight, SpotLight, GLProgram, GLShader, vertexTemplate, fragmentTemplate, convertColorToVector, allocateTextureUnit, vec3, vec4, mat3, mat4, GL, PhongMaterial, PhongRenderer, ColorStrategy, StaticColorStrategy, boundsBuffer, TextureRegion, TextureColorStrategy;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersCreateClass) {
            _createClass = _npmBabelRuntime543HelpersCreateClass['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsGetIterator) {
            _getIterator = _npmBabelRuntime543CoreJsGetIterator['default'];
        }, function (_npmBabelRuntime543CoreJsObjectAssign) {
            _Object$assign = _npmBabelRuntime543CoreJsObjectAssign['default'];
        }, function (_npmBabelRuntime543CoreJsMathLog2) {
            _Math$log2 = _npmBabelRuntime543CoreJsMathLog2['default'];
        }, function (_npmBabelRuntime543CoreJsMap) {
            _Map = _npmBabelRuntime543CoreJsMap['default'];
        }, function (_npmBabelRuntime543CoreJsSet) {
            _Set = _npmBabelRuntime543CoreJsSet['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }, function (_npmMemoizee038) {
            memoize = _npmMemoizee038['default'];
        }, function (_libExtraAtlas) {
            Atlas = _libExtraAtlas.Atlas;
            Region = _libExtraAtlas.Region;
        }, function (_libMaterialBase) {
            Material = _libMaterialBase.Material;
            MaterialRenderer = _libMaterialBase.MaterialRenderer;
        }, function (_libTextureTexture2d) {
            Texture2D = _libTextureTexture2d['default'];
        }, function (_libExtraFunctional) {
            construct = _libExtraFunctional.construct;
            delegate = _libExtraFunctional.delegate;
        }, function (_libLightDirectionalLight) {
            DirectionalLight = _libLightDirectionalLight['default'];
        }, function (_libLightPointlight) {
            PointLight = _libLightPointlight['default'];
        }, function (_libLightSpotlight) {
            SpotLight = _libLightSpotlight['default'];
        }, function (_libWebglProgram) {
            GLProgram = _libWebglProgram['default'];
        }, function (_libWebglShader) {
            GLShader = _libWebglShader['default'];
        }, function (_libMaterialShadersPhongVertDotLibPluginsDot) {
            vertexTemplate = _libMaterialShadersPhongVertDotLibPluginsDot['default'];
        }, function (_libMaterialShadersPhongFragDotLibPluginsDot) {
            fragmentTemplate = _libMaterialShadersPhongFragDotLibPluginsDot['default'];
        }, function (_libExtraColor) {
            convertColorToVector = _libExtraColor.convertColorToVector;
        }, function (_libTextureCommon) {
            allocateTextureUnit = _libTextureCommon.allocateTextureUnit;
        }],
        execute: function () {
            'use strict';

            vec3 = glm.vec3;
            vec4 = glm.vec4;
            mat3 = glm.mat3;
            mat4 = glm.mat4;
            GL = WebGLRenderingContext;

            /**
             * A material defining the properties used for Phong shading.
             */

            PhongMaterial = (function (_Material) {
                function PhongMaterial() {
                    var _ref4 = arguments[0] === undefined ? {} : arguments[0];

                    var _ref4$shininess = _ref4.shininess;
                    var shininess = _ref4$shininess === undefined ? 40 : _ref4$shininess;
                    var _ref4$ambient = _ref4.ambient;
                    var ambient = _ref4$ambient === undefined ? 0 : _ref4$ambient;
                    var _ref4$diffuse = _ref4.diffuse;
                    var diffuse = _ref4$diffuse === undefined ? 8421504 : _ref4$diffuse;
                    var _ref4$specular = _ref4.specular;
                    var specular = _ref4$specular === undefined ? diffuse : _ref4$specular;

                    _classCallCheck(this, PhongMaterial);

                    _Material.call(this);
                    this.shininess = shininess;
                    this.ambient = ambient;
                    this.diffuse = diffuse;
                    this.specular = specular;

                    // Object.seal(this);
                }

                _inherits(PhongMaterial, _Material);

                /**
                 * Returns a renderer bound to this material instance.
                 * Should always produce the same instance for each WebGL rendering context and material.
                 */

                PhongMaterial.prototype.getRenderer = function getRenderer(gl) {
                    return PhongRenderer.create(this, gl);
                };

                PhongMaterial.getSourceType = function getSourceType(source) {
                    switch (source.constructor) {
                        case Number:case Array:case Float32Array:
                            return 'static';
                        case Texture2D:
                            return 'texture';
                        default:
                            console.error('Incompatible material source color type');
                    }
                };

                _createClass(PhongMaterial, [{
                    key: 'config',
                    get: function () {
                        return {
                            'ambient': PhongMaterial.getSourceType(this.ambient),
                            'diffuse': PhongMaterial.getSourceType(this.diffuse),
                            'specular': PhongMaterial.getSourceType(this.specular)
                        };
                    }
                }]);

                return PhongMaterial;
            })(Material);

            _export('default', PhongMaterial);

            PhongRenderer = (function (_MaterialRenderer) {
                function PhongRenderer(material, gl) {
                    _classCallCheck(this, PhongRenderer);

                    _MaterialRenderer.call(this, material);

                    this.gl = gl;
                    this.locations = null;
                    this.ambientStrategy = null;
                    this.diffuseStrategy = null;
                    this.specularStrategy = null;
                }

                _inherits(PhongRenderer, _MaterialRenderer);

                PhongRenderer.prototype.init = function init() {
                    var _ref5 = arguments[0] === undefined ? {} : arguments[0];

                    var _ref5$_lightRenderers = _ref5._lightRenderers;

                    var _lightRenderers = _ref5$_lightRenderers === undefined ? [] : _ref5$_lightRenderers;

                    var lightTypeCounts = {
                        'MAX_DIRECTIONAL_LIGHTS': 0,
                        'MAX_SPOT_LIGHTS': 0,
                        'MAX_POINT_LIGHTS': 0
                    };

                    for (var _iterator = _lightRenderers, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _getIterator(_iterator);;) {
                        var _ref;

                        if (_isArray) {
                            if (_i >= _iterator.length) break;
                            _ref = _iterator[_i++];
                        } else {
                            _i = _iterator.next();
                            if (_i.done) break;
                            _ref = _i.value;
                        }

                        var lightRenderer = _ref;

                        var light = lightRenderer.light;
                        if (light instanceof DirectionalLight) lightTypeCounts['MAX_DIRECTIONAL_LIGHTS'] += 1;else if (light instanceof SpotLight) lightTypeCounts['MAX_SPOT_LIGHTS'] += 1;else if (light instanceof PointLight) lightTypeCounts['MAX_POINT_LIGHTS'] += 1;
                    }

                    var config = _Object$assign({}, lightTypeCounts, this.material.config);

                    this.program = PhongRenderer.createProgram(this.gl, JSON.stringify(config), config);

                    this.ambientStrategy = ColorStrategy.select('ambient', this.material.ambient, this.program);
                    this.diffuseStrategy = ColorStrategy.select('diffuse', this.material.diffuse, this.program);
                    this.specularStrategy = ColorStrategy.select('specular', this.material.specular, this.program);

                    if (this.geometryRenderer) {
                        this.setGeometryRenderer(this.geometryRenderer);
                    }
                };

                /**
                 * Runs once for each geometry using this material.
                 * Should be used to bind geometry buffers to program attributes, and cache uniform locations.
                 */

                PhongRenderer.prototype.setGeometryRenderer = function setGeometryRenderer(geometryRenderer) {
                    this.geometryRenderer = geometryRenderer;

                    var vertexBuffer = geometryRenderer.vertexBuffer;
                    var normalBuffer = geometryRenderer.normalBuffer;
                    var texcoordBuffer = geometryRenderer.texcoordBuffer;

                    vertexBuffer.setAttribLocation('vertex', this.program);
                    normalBuffer.setAttribLocation('normal', this.program);

                    this.locations = {
                        mvpMatrix: this.program.getUniformLocation('mvpMatrix'),
                        modelMatrix: this.program.getUniformLocation('modelMatrix'),
                        normalMatrix: this.program.getUniformLocation('normalMatrix'),
                        viewPos: this.program.getUniformLocation('viewPos'),
                        shininess: this.program.getUniformLocation('material.shininess'),
                        environmentAmbient: this.program.getUniformLocation('environmentAmbient')
                    };

                    this.ambientStrategy.init(texcoordBuffer);
                    this.diffuseStrategy.init(texcoordBuffer);
                    this.specularStrategy.init(texcoordBuffer);
                };

                /**
                 * Runs once before drawing the models using the material.
                 * Should be used to set material uniforms independent of model drawn.
                 */

                PhongRenderer.prototype.beforeRender = function beforeRender(_ref6) {
                    var camera = _ref6.camera;
                    var environment = _ref6.environment;
                    var lightRenderers = _ref6._lightRenderers;

                    var gl = this.program.gl;
                    var locations = this.locations;

                    for (var i = 0, len = lightRenderers.length; i < len; ++i) {
                        lightRenderers[i].render(this.program);
                    }

                    gl.uniform3fv(locations.viewPos, camera.worldPosition);
                    gl.uniform1f(locations.shininess, this.material.shininess);

                    gl.uniform3fv(locations.environmentAmbient, environment._ambientVector);

                    this.ambientStrategy.update();
                    this.diffuseStrategy.update();
                    this.specularStrategy.update();
                };

                /**
                 * Runs before drawing each model using the material.
                 * Should be used to set material uniforms dependent on model drawn.
                 */

                PhongRenderer.prototype.render = function render(model, renderer) {
                    var gl = this.program.gl;
                    var locations = this.locations;

                    gl.uniformMatrix4fv(locations.mvpMatrix, false, model.mvpMatrix);
                    gl.uniformMatrix4fv(locations.modelMatrix, false, model.worldTransform);
                    gl.uniformMatrix3fv(locations.normalMatrix, false, model.normalMatrix);
                };

                _createClass(PhongRenderer, null, [{
                    key: 'create',
                    value: memoize(construct(PhongRenderer), { length: 2 }),
                    enumerable: true
                }, {
                    key: 'createProgram',
                    value: memoize(function (gl, configString, config) {
                        return new GLProgram(gl, new GLShader(gl, vertexTemplate(config), GL.VERTEX_SHADER), new GLShader(gl, fragmentTemplate(config), GL.FRAGMENT_SHADER));
                    }, { length: 2 }),
                    enumerable: true
                }]);

                return PhongRenderer;
            })(MaterialRenderer);

            /**
             * @abstract
             */

            ColorStrategy = (function () {
                function ColorStrategy(target, source, program) {
                    _classCallCheck(this, ColorStrategy);

                    this.locations = {};

                    this.target = target;
                    this.source = source;
                    this.program = program;
                }

                ColorStrategy.prototype.init = function init(texcoordBuffer) {};

                ColorStrategy.prototype.update = function update() {};

                _createClass(ColorStrategy, null, [{
                    key: 'select',
                    value: memoize(function (target, source, program) {
                        return ({
                            'static': StaticColorStrategy.create,
                            'texture': TextureColorStrategy.create
                        })[PhongMaterial.getSourceType(source)](target, source, program);
                    }),

                    /*
                    static select = delegate((_, source) => {
                        switch (PhongMaterial.getSourceType(source)) {
                            case 'static':  return StaticColorStrategy.create;
                            case 'texture': return TextureColorStrategy.create;
                        }
                    });
                    */
                    enumerable: true
                }]);

                return ColorStrategy;
            })();

            StaticColorStrategy = (function (_ColorStrategy) {
                function StaticColorStrategy(target, source, program) {
                    _classCallCheck(this, StaticColorStrategy);

                    _ColorStrategy.call(this, target, source, program);
                    this.color = source;
                    this.colorVector = convertColorToVector(this.color);
                }

                _inherits(StaticColorStrategy, _ColorStrategy);

                StaticColorStrategy.prototype.init = function init(texcoordBuffer) {
                    this.locations.target = this.program.getUniformLocation('material.' + this.target);
                };

                StaticColorStrategy.prototype.update = function update() {
                    convertColorToVector(this.color, this.colorVector);
                    this.program.gl.uniform3fv(this.locations.target, this.colorVector);
                };

                _createClass(StaticColorStrategy, null, [{
                    key: 'create',
                    value: memoize(construct(StaticColorStrategy), { length: 3 }),
                    enumerable: true
                }]);

                return StaticColorStrategy;
            })(ColorStrategy);

            boundsBuffer = vec4.create();

            TextureRegion = (function () {
                function TextureRegion(gl, region, strategies) {
                    _classCallCheck(this, TextureRegion);

                    this.gl = gl;
                    this.region = region;
                    this.unit = allocateTextureUnit();
                    this.handle = gl.createTexture();
                    this.ctx = document.createElement('canvas').getContext('2d');

                    this.strategies = strategies;

                    document.body.appendChild(this.ctx.canvas);
                }

                TextureRegion.prototype.bind = function bind() {
                    this.gl.activeTexture(GL.TEXTURE0 + this.unit);
                    this.gl.bindTexture(GL.TEXTURE_2D, this.handle);
                };

                TextureRegion.prototype.updateTexcoordBounds = function updateTexcoordBounds(subregion) {
                    var size = this.region.outerWidth;

                    vec4.set(boundsBuffer, subregion.left / size, (subregion.top + subregion.innerHeight) / size, subregion.innerWidth / size, -(subregion.innerHeight / size));

                    for (var _iterator2 = this.strategies.get(subregion.image), _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _getIterator(_iterator2);;) {
                        var _ref2;

                        if (_isArray2) {
                            if (_i2 >= _iterator2.length) break;
                            _ref2 = _iterator2[_i2++];
                        } else {
                            _i2 = _iterator2.next();
                            if (_i2.done) break;
                            _ref2 = _i2.value;
                        }

                        var strategy = _ref2;

                        vec4.copy(strategy.texcoordBounds, boundsBuffer);
                        strategy.textureRegion = this;
                    }
                };

                // Full update

                TextureRegion.prototype.uploadRegion = function uploadRegion() {
                    // Resize and clear canvas
                    this.ctx.canvas.width = this.region.outerWidth;
                    this.ctx.canvas.height = this.region.outerHeight;
                    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

                    // Draw subregion's imagedata into canvas
                    for (var _iterator3 = this.region, _isArray3 = Array.isArray(_iterator3), _i3 = 0, _iterator3 = _isArray3 ? _iterator3 : _getIterator(_iterator3);;) {
                        var _ref3;

                        if (_isArray3) {
                            if (_i3 >= _iterator3.length) break;
                            _ref3 = _iterator3[_i3++];
                        } else {
                            _i3 = _iterator3.next();
                            if (_i3.done) break;
                            _ref3 = _i3.value;
                        }

                        var _subregion = _ref3;

                        this.ctx.putImageData(_subregion.image, _subregion.left, _subregion.top);
                        this.updateTexcoordBounds(_subregion);
                    }

                    this.bind();

                    // Upload the entire canvas element as a texture. (Yes, this works!)
                    this.gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, this.ctx.canvas);
                    this.gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
                    this.gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
                    this.gl.generateMipmap(GL.TEXTURE_2D);
                };

                // Partial update

                TextureRegion.prototype.uploadSubregion = function uploadSubregion(subregion) {
                    // Draw imagedata into canvas
                    this.ctx.putImageData(subregion.image, subregion.left, subregion.top);
                    this.updateTexcoordBounds(subregion);

                    this.bind();

                    // Upload only the subregion used
                    this.gl.texSubImage2D(GL.TEXTURE_2D, 0, subregion.left, subregion.top, GL.RGBA, GL.UNSIGNED_BYTE, subregion.image);
                    this.gl.generateMipmap(GL.TEXTURE_2D);
                };

                return TextureRegion;
            })();

            TextureColorStrategy = (function (_ColorStrategy2) {
                function TextureColorStrategy(target, source, program) {
                    _classCallCheck(this, TextureColorStrategy);

                    _ColorStrategy2.call(this, target, source, program);
                    this.texcoordBounds = vec4.create();
                    this.textureRegion = null;

                    TextureColorStrategy.getConfig(program.gl)(this);
                }

                _inherits(TextureColorStrategy, _ColorStrategy2);

                TextureColorStrategy.prototype.init = function init(texcoordBuffer) {
                    texcoordBuffer.setAttribLocation('texcoord', this.program);

                    this.locations.sampler = this.program.getUniformLocation('' + this.target + 'Sampler');
                    this.locations.bounds = this.program.getUniformLocation('' + this.target + 'TexcoordBounds');
                };

                TextureColorStrategy.prototype.update = function update() {
                    var gl = this.program.gl;
                    gl.uniform1i(this.locations.sampler, this.textureRegion.unit);
                    gl.uniform4fv(this.locations.bounds, this.texcoordBounds);

                    this.textureRegion.bind();
                };

                _createClass(TextureColorStrategy, null, [{
                    key: 'getConfig',
                    value: memoize(function (gl) {

                        // Create the atlas that manages a set of regions
                        var atlas = new Atlas({ maxSize: _Math$log2(gl.getParameter(GL.MAX_TEXTURE_SIZE)) });

                        // A data structure that keeps track which strategies are using which images
                        var strategiesUsingImage = new _Map(); //Map<ImageData, Set<TextureColorStrategy>>

                        // Objects that manage uploading a region into a texture unit
                        var textureRegions = [new TextureRegion(gl, atlas.regions[0], strategiesUsingImage)];

                        return function (strategy) {

                            var texture = strategy.source;

                            var strategies = strategiesUsingImage.get(texture.imageData);
                            if (strategies === undefined) {
                                strategies = new _Set();
                                strategiesUsingImage.set(texture.imageData, strategies);
                            }
                            strategies.add(strategy);

                            var _atlas$insert = atlas.insert(texture.imageData);

                            var result = _atlas$insert[0];

                            var data = _atlas$insert.slice(1);

                            switch (result) {
                                case Atlas.SUCCESS:
                                    var regionIndex = data[0],
                                        subregion = data[1];

                                    textureRegions[regionIndex].uploadSubregion(subregion);

                                    return textureRegions[regionIndex];

                                case Atlas.RESET:

                                    for (var i = 0, len = atlas.regions.length; i < len; ++i) {

                                        if (textureRegions[i] === undefined) {
                                            textureRegions[i] = new TextureRegion(gl, atlas.regions[i], strategiesUsingImage);
                                        } else {
                                            textureRegions[i].region = atlas.regions[i];
                                        }

                                        textureRegions[i].uploadRegion();
                                    }

                                    break;

                                case Atlas.FAILED:
                                    var message = data[0];

                                    throw message;
                            }
                        };
                    }),
                    enumerable: true
                }, {
                    key: 'create',
                    value: memoize(construct(TextureColorStrategy), { length: 3 }),
                    enumerable: true
                }]);

                return TextureColorStrategy;
            })(ColorStrategy);
        }
    };
});
System.register('lib/scene/base', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/create-class', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/get-iterator', 'npm:babel-runtime@5.4.3/core-js/symbol/iterator', 'npm:babel-runtime@5.4.3/regenerator', 'github:toji/gl-matrix@master', 'lib/extra/event-aggregator', 'lib/extra/bounding-box'], function (_export) {
    var _inherits, _createClass, _classCallCheck, _getIterator, _Symbol$iterator, _regeneratorRuntime, glm, EventAggregator, BoundingBox, vec3, mat3, mat4, quat, deg2rad, tmp, instances, Scene;

    function fromRotationTranslationScale(out, rotation, translation, scale) {
        var x = rotation[0],
            y = rotation[1],
            z = rotation[2],
            w = rotation[3],
            x2 = x + x,
            y2 = y + y,
            z2 = z + z,
            xx = x * x2,
            xy = x * y2,
            xz = x * z2,
            yy = y * y2,
            yz = y * z2,
            zz = z * z2,
            wx = w * x2,
            wy = w * y2,
            wz = w * z2,
            sx = scale[0],
            sy = scale[1],
            sz = scale[2];

        out[0] = (1 - (yy + zz)) * sx;
        out[1] = (xy + wz) * sx;
        out[2] = (xz - wy) * sx;
        out[3] = 0;
        out[4] = (xy - wz) * sy;
        out[5] = (1 - (xx + zz)) * sy;
        out[6] = (yz + wx) * sy;
        out[7] = 0;
        out[8] = (xz + wy) * sz;
        out[9] = (yz - wx) * sz;
        out[10] = (1 - (xx + yy)) * sz;
        out[11] = 0;
        out[12] = translation[0];
        out[13] = translation[1];
        out[14] = translation[2];
        out[15] = 1;

        return out;
    }
    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersCreateClass) {
            _createClass = _npmBabelRuntime543HelpersCreateClass['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsGetIterator) {
            _getIterator = _npmBabelRuntime543CoreJsGetIterator['default'];
        }, function (_npmBabelRuntime543CoreJsSymbolIterator) {
            _Symbol$iterator = _npmBabelRuntime543CoreJsSymbolIterator['default'];
        }, function (_npmBabelRuntime543Regenerator) {
            _regeneratorRuntime = _npmBabelRuntime543Regenerator['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }, function (_libExtraEventAggregator) {
            EventAggregator = _libExtraEventAggregator['default'];
        }, function (_libExtraBoundingBox) {
            BoundingBox = _libExtraBoundingBox['default'];
        }],
        execute: function () {
            'use strict';

            vec3 = glm.vec3;
            mat3 = glm.mat3;
            mat4 = glm.mat4;
            quat = glm.quat;
            deg2rad = Math.PI / 180;
            tmp = vec3.create();
            instances = [];

            Scene = (function (_EventAggregator) {
                function Scene(name) {
                    var _ref2 = arguments[1] === undefined ? {} : arguments[1];

                    var _ref2$parent = _ref2.parent;
                    var parent = _ref2$parent === undefined ? null : _ref2$parent;
                    var _ref2$position = _ref2.position;
                    var position = _ref2$position === undefined ? [0, 0, 0] : _ref2$position;
                    var _ref2$rotateX = _ref2.rotateX;
                    var rotateX = _ref2$rotateX === undefined ? 0 : _ref2$rotateX;
                    var _ref2$rotateY = _ref2.rotateY;
                    var rotateY = _ref2$rotateY === undefined ? 0 : _ref2$rotateY;
                    var _ref2$rotateZ = _ref2.rotateZ;
                    var rotateZ = _ref2$rotateZ === undefined ? 0 : _ref2$rotateZ;
                    var _ref2$scale = _ref2.scale;
                    var scale = _ref2$scale === undefined ? 1 : _ref2$scale;

                    _classCallCheck(this, Scene);

                    _EventAggregator.call(this, parent);

                    this.id = Scene.instances.length;
                    Scene.instances.push(this);

                    this.name = name;
                    this.parent = parent;

                    this.orientation = quat.create();
                    this.position = vec3.create();
                    this.scale = vec3.fromValues(1, 1, 1);

                    this.localTransform = mat4.create();
                    this.worldTransform = mat4.create();

                    this.normalMatrix = mat3.create();

                    this.subtreeIds = [this.id];

                    // Axis-aligned bounding box (world space)
                    this.aabb = new BoundingBox();

                    this.dirty = true;
                    this.processing = true;

                    // Order is important here
                    this.resize(scale);
                    this.rotateX(rotateX); // pitch
                    this.rotateZ(rotateZ); // roll
                    this.rotateY(rotateY); // yaw
                    this.translate(position);
                }

                _inherits(Scene, _EventAggregator);

                Scene.prototype.toString = function toString() {
                    var _this = this;

                    var props = arguments[0] === undefined ? ['name', 'dirty'] : arguments[0];
                    var depth = arguments[1] === undefined ? 0 : arguments[1];

                    var empty = '';
                    var space = ' ';
                    for (var i = 0; i < 2 * depth; ++i) {
                        empty += space;
                    }
                    return empty + this.constructor.name + ': { ' + props.map(function (prop) {
                        return prop + ': ' + _this[prop];
                    }).join(', ') + ' }';
                };

                // TODO: more complex stuff

                Scene.prototype.query = function query(name) {
                    for (var _iterator = this, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _getIterator(_iterator);;) {
                        var _ref;

                        if (_isArray) {
                            if (_i >= _iterator.length) break;
                            _ref = _iterator[_i++];
                        } else {
                            _i = _iterator.next();
                            if (_i.done) break;
                            _ref = _i.value;
                        }

                        var node = _ref;

                        if (node.name === name) {
                            return node;
                        }
                    }
                };

                Scene.prototype.forEach = function forEach(cb) {
                    cb(this);
                };

                Scene.prototype[_Symbol$iterator] = _regeneratorRuntime.mark(function callee$1$0() {
                    return _regeneratorRuntime.wrap(function callee$1$0$(context$2$0) {
                        while (1) switch (context$2$0.prev = context$2$0.next) {
                            case 0:
                                context$2$0.next = 2;
                                return this;

                            case 2:
                            case 'end':
                                return context$2$0.stop();
                        }
                    }, callee$1$0, this);
                });

                /// Recalculate local and world transforms

                Scene.prototype.recalculate = function recalculate(existingNodes) {
                    // Recalculate if something changed
                    if (this.dirty) {
                        var localTransform = this.localTransform;
                        var worldTransform = this.worldTransform;

                        fromRotationTranslationScale(localTransform, this.orientation, this.position, this.scale);

                        if (this.parent) {
                            mat4.multiply(worldTransform, this.parent.worldTransform, localTransform);
                        } else {
                            mat4.copy(worldTransform, localTransform);
                        }

                        mat3.normalFromMat4(this.normalMatrix, worldTransform);
                    }

                    existingNodes.set(this.id);

                    var dirty = this.dirty;
                    this.dirty = false;
                    return dirty;
                };

                Scene.prototype.recalculateSubtreeIds = function recalculateSubtreeIds() {};

                Scene.prototype.resize = function resize(amount) {
                    (typeof amount === 'number' ? vec3.scale : vec3.multiply)(this.scale, this.scale, amount);
                    this.dirty = true;
                };

                Scene.prototype.rotateX = function rotateX(deg) {
                    quat.rotateX(this.orientation, this.orientation, deg * deg2rad);
                    this.dirty = true;
                };

                Scene.prototype.rotateY = function rotateY(deg) {
                    quat.rotateY(this.orientation, this.orientation, deg * deg2rad);
                    this.dirty = true;
                };

                Scene.prototype.rotateZ = function rotateZ(deg) {
                    quat.rotateZ(this.orientation, this.orientation, deg * deg2rad);
                    this.dirty = true;
                };

                Scene.prototype.lookForward = function lookForward() {
                    quat.identity(this.orientation);
                    this.dirty = true;
                };

                Scene.prototype.translate = function translate(v) {
                    vec3.add(this.position, this.position, v);
                    this.dirty = true;
                };

                Scene.prototype.translateRelatively = function translateRelatively(v) {
                    vec3.add(this.position, this.position, vec3.transformQuat(tmp, v, this.orientation));
                    this.dirty = true;
                };

                Scene.prototype.getEulerAngles = function getEulerAngles() {
                    var q = this.orientation;

                    var roll = Math.atan2(2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2]));
                    var pitch = Math.asin(2 * (q[0] * q[2] - q[3] * q[1]));
                    var yaw = Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]));

                    return { roll: roll, pitch: pitch, yaw: yaw };
                };

                _createClass(Scene, null, [{
                    key: 'instances',
                    value: [],
                    enumerable: true
                }]);

                return Scene;
            })(EventAggregator);

            _export('default', Scene);

            ;
        }
    };
});
System.register('lib/camera/base', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'github:toji/gl-matrix@master', 'lib/scene/base'], function (_export) {
    var _inherits, _classCallCheck, glm, Scene, mat3, mat4, vec3, vec4, Camera;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }, function (_libSceneBase) {
            Scene = _libSceneBase['default'];
        }],
        execute: function () {
            'use strict';

            mat3 = glm.mat3;
            mat4 = glm.mat4;
            vec3 = glm.vec3;
            vec4 = glm.vec4;

            /**
             * @abstract
             */

            Camera = (function (_Scene) {
                function Camera() {
                    var options = arguments[0] === undefined ? {} : arguments[0];

                    _classCallCheck(this, Camera);

                    _Scene.call(this, 'camera', options);

                    this.projectionMatrix = mat4.create(); // view -> clip
                    this.viewMatrix = mat4.create(); // world -> view
                    this.cameraMatrix = mat4.create(); // world -> clip

                    this.worldPosition = vec3.create();

                    // (6 * vec4)
                    this.planes = new Float64Array(24);

                    // Store for each plane the indices to n and p points
                    // (6 * (byte + byte))
                    this.npOffsets = new Uint8Array(12);

                    this._lastFailedPlanes = [];
                }

                _inherits(Camera, _Scene);

                Camera.prototype.recalculate = function recalculate(existingNodes) {
                    this.dirty = _Scene.prototype.recalculate.call(this, existingNodes);

                    if (this.dirty) {
                        mat4.invert(this.viewMatrix, this.worldTransform);
                        mat4.multiply(this.cameraMatrix, this.projectionMatrix, this.viewMatrix);

                        var p = this.planes;
                        var m = this.cameraMatrix;

                        // Directly extract planes (a, b, c, d) from cameraMatrix
                        p[0] = m[0] + m[3];p[1] = m[4] + m[7];p[2] = m[8] + m[11];p[3] = m[12] + m[15]; // left
                        p[4] = -m[0] + m[3];p[5] = -m[4] + m[7];p[6] = -m[8] + m[11];p[7] = -m[12] + m[15]; // right
                        p[8] = m[1] + m[3];p[9] = m[5] + m[7];p[10] = m[9] + m[11];p[11] = m[13] + m[15]; // bottom
                        p[12] = -m[1] + m[3];p[13] = -m[5] + m[7];p[14] = -m[9] + m[11];p[15] = -m[13] + m[15]; // top
                        p[16] = m[2] + m[3];p[17] = m[6] + m[7];p[18] = m[10] + m[11];p[19] = m[14] + m[15]; // near
                        p[20] = -m[2] + m[3];p[21] = -m[6] + m[7];p[22] = -m[10] + m[11];p[23] = -m[14] + m[15]; // far

                        var offs = this.npOffsets;

                        var a = undefined,
                            b = undefined,
                            c = undefined,
                            d = undefined,
                            i = undefined;
                        for (var offset = 0; offset < 24; offset += 4) {
                            a = p[offset];
                            b = p[offset + 1];
                            c = p[offset + 2];
                            d = p[offset + 3];

                            i = 2 * (2 * (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0)) + (c > 0 ? 1 : 0);

                            offs[offset >> 1] = 3 * i;
                            offs[(offset >> 1) + 1] = 3 * (7 - i);
                        }

                        if (this.parent) {
                            vec3.transformMat4(this.worldPosition, this.position, this.parent.worldTransform);
                        } else {
                            vec3.copy(this.worldPosition, this.position);
                        }
                    }

                    return this.dirty;
                };

                Camera.prototype.canSee = function canSee(node, mask) {

                    var points = node.aabb.points;
                    var planes = this.planes;
                    var lastFailedPlane = this._lastFailedPlanes[node.id];
                    var npOffsets = this.npOffsets;

                    // The mask is a bitfield
                    // 0: parent is inside plane i, no need to test
                    // 1: parent intersects plane i, test it
                    var inMask = mask[0];
                    var outMask = 0;

                    // 0: OUTSIDE
                    // 1: INSIDE
                    // 2: INTERSECT
                    var result = 1;

                    var a = undefined,
                        b = undefined,
                        c = undefined,
                        d = undefined;
                    var nOffset = undefined,
                        pOffset = undefined;

                    // Set initial k-value to be the bit at the last plane
                    var k = 1 << (lastFailedPlane >> 2);
                    var offset = lastFailedPlane;

                    // Check against last failed plane first
                    if (lastFailedPlane !== -1 && k & inMask) {
                        // Fetch offset to n-vertex
                        nOffset = npOffsets[offset >> 1];

                        // Extract plane coefficients
                        a = planes[offset];b = planes[offset + 1];c = planes[offset + 2];d = planes[offset + 3];

                        // Check if outside the plane
                        if (a * points[nOffset] + b * points[nOffset + 1] + c * points[nOffset + 2] < -d) {
                            mask[0] = outMask;
                            return 0;
                        }

                        // Fetch offsets to p-vertex
                        pOffset = npOffsets[(offset >> 1) + 1];

                        // Check if intersects with the plane
                        if (a * points[pOffset] + b * points[pOffset + 1] + c * points[pOffset + 2] < -d) {
                            outMask |= k;
                            result = 2;
                        }
                    }

                    // Check against remaining planes
                    for (offset = 0, k = 1; k <= inMask /*offset < 24*/; offset += 4, k += k) {
                        if (offset !== lastFailedPlane && k & inMask) {

                            // Extract plane coefficients
                            a = planes[offset];
                            b = planes[offset + 1];
                            c = planes[offset + 2];
                            d = planes[offset + 3];

                            // Fetch offset to n-vertex
                            nOffset = npOffsets[offset >> 1];

                            // Check if outside the plane
                            if (a * points[nOffset] + b * points[nOffset + 1] + c * points[nOffset + 2] < -d) {
                                this._lastFailedPlanes[node.id] = offset;
                                mask[0] = outMask;
                                return 0;
                            }

                            // Fetch offsets to p-vertex
                            pOffset = npOffsets[(offset >> 1) + 1];

                            // Check if intersects with the plane
                            if (a * points[pOffset] + b * points[pOffset + 1] + c * points[pOffset + 2] < -d) {
                                outMask |= k;
                                result = 2;
                            }
                        }
                    }

                    mask[0] = outMask;

                    // Inside the plane
                    return result;
                };

                return Camera;
            })(Scene);

            _export('default', Camera);
        }
    };
});
System.register('lib/geometry/geometry', ['npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/helpers/create-class', 'npm:memoizee@0.3.8', 'lib/extra/bounding-box', 'lib/webgl/buffer', 'lib/webgl/program', 'lib/extra/functional', 'lib/extra/ajax', 'lib/workers/wavefront', 'lib/workers/normal-vectors'], function (_export) {
    var _classCallCheck, _createClass, memoize, BoundingBox, GLBuffer, GLProgram, construct, getArrayBuffer, wavefrontWorker, normalsWorker, GL, Geometry, GeometryRenderer;

    return {
        setters: [function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543HelpersCreateClass) {
            _createClass = _npmBabelRuntime543HelpersCreateClass['default'];
        }, function (_npmMemoizee038) {
            memoize = _npmMemoizee038['default'];
        }, function (_libExtraBoundingBox) {
            BoundingBox = _libExtraBoundingBox['default'];
        }, function (_libWebglBuffer) {
            GLBuffer = _libWebglBuffer['default'];
        }, function (_libWebglProgram) {
            GLProgram = _libWebglProgram['default'];
        }, function (_libExtraFunctional) {
            construct = _libExtraFunctional.construct;
        }, function (_libExtraAjax) {
            getArrayBuffer = _libExtraAjax.getArrayBuffer;
        }, function (_libWorkersWavefront) {
            wavefrontWorker = _libWorkersWavefront.workerpool;
        }, function (_libWorkersNormalVectors) {
            normalsWorker = _libWorkersNormalVectors.workerpool;
        }],
        execute: function () {
            'use strict';

            GL = WebGLRenderingContext;

            /**
             * A geometric mesh.
             */

            Geometry = (function () {
                function Geometry() {
                    var _ref = arguments[0] === undefined ? {} : arguments[0];

                    var vertices = _ref.vertices;
                    var indices = _ref.indices;
                    var texcoords = _ref.texcoords;
                    var _ref$normals = _ref.normals;
                    var normals = _ref$normals === undefined ? new Float32Array(vertices.length) : _ref$normals;

                    _classCallCheck(this, Geometry);

                    var ensureType = function ensureType(array, Type) {
                        return array instanceof Type ? array : new Type(array);
                    };
                    this.vertices = ensureType(vertices, Float32Array);
                    this.indices = ensureType(indices, Uint16Array);
                    this.normals = ensureType(normals, Float32Array);
                    this.texcoords = ensureType(texcoords, Float32Array);

                    this.bounds = new BoundingBox();
                    this.bounds.expandIntervals(this.vertices);
                    this.bounds.computePoints();
                }

                Geometry.fromFile = function fromFile(filename) {
                    var extension = filename.split('.').pop();
                    switch (extension) {
                        case 'obj':
                            return getArrayBuffer(filename).then(function (stringBuffer) {
                                return wavefrontWorker.run(stringBuffer, { transfers: [stringBuffer] });
                            }).then(function (data) {
                                var geometry = new Geometry(data);

                                if (geometry.normals.length === 0) {
                                    return geometry.generateNormals();
                                } else {
                                    return geometry;
                                }
                            });

                        default:
                            throw new Error('Unsupported geometry file extension: ".' + extension + '"');
                    }
                };

                /**
                 * Generates vertex normals by calculating the area-weighted sum of all connecting triangle normals.
                 * WARNING: Internal buffers are transferred while encoding, so DO NOT attempt to use geometry until promise is resolved!
                 */

                Geometry.prototype.generateNormals = function generateNormals() {
                    var _this = this;

                    return normalsWorker.run({ vertices: this.vertices, indices: this.indices }, { transfers: [this.vertices.buffer, this.indices.buffer] }).then(function (_ref2) {
                        var vertices = _ref2.vertices;
                        var indices = _ref2.indices;
                        var normals = _ref2.normals;

                        _this.vertices = vertices;
                        _this.indices = indices;
                        _this.normals = normals;
                        return _this;
                    });
                };

                Geometry.prototype.getRenderer = function getRenderer(gl) {
                    return GeometryRenderer.create(this, gl);
                };

                return Geometry;
            })();

            _export('default', Geometry);

            /**
             * Handles the drawing of a geometry for a specific WebGL context.
             * Binds buffers on creation, and draws elements when calling "draw()".
             * Does not bind shader program attributes, needs to be done in material renderer.
             */

            GeometryRenderer = (function () {
                function GeometryRenderer(geometry, gl) {
                    _classCallCheck(this, GeometryRenderer);

                    this.gl = gl;
                    this.geometry = geometry;

                    var vaoExtension = gl.getExtension('OES_vertex_array_object');

                    if (vaoExtension) {
                        this.vaoExtension = vaoExtension;
                        this.vao = this.vaoExtension.createVertexArrayOES();
                    }

                    this.vertexBuffer = new GLBuffer(gl, geometry.vertices, this.vao);
                    this.normalBuffer = new GLBuffer(gl, geometry.normals, this.vao);
                    this.texcoordBuffer = new GLBuffer(gl, geometry.texcoords, this.vao, { size: 2 });
                    this.indexBuffer = new GLBuffer(gl, geometry.indices, this.vao, { bufferType: GL.ELEMENT_ARRAY_BUFFER });

                    // Object.freeze(this);
                }

                // Draws the geometry

                GeometryRenderer.prototype.render = function render() {
                    if (this.vao) {
                        this.vaoExtension.bindVertexArrayOES(this.vao);
                    } else {
                        // Rebind buffers and vertex attrib pointers manually
                        this.vertexBuffer.bind();
                        this.normalBuffer.bind();
                        this.texcoordBuffer.bind();
                        this.indexBuffer.bind();
                    }

                    this.gl.drawElements(GL.TRIANGLES, this.indexBuffer.data.length, GL.UNSIGNED_SHORT, 0);

                    if (this.vao) this.vaoExtension.bindVertexArrayOES(null);
                };

                _createClass(GeometryRenderer, null, [{
                    key: 'create',
                    value: memoize(construct(GeometryRenderer), { length: 2 }),
                    enumerable: true
                }]);

                return GeometryRenderer;
            })();

            _export('GeometryRenderer', GeometryRenderer);
        }
    };
});
System.register('lib/scene/model', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/promise', 'lib/scene/base', 'lib/geometry/geometry', 'lib/material/base', 'lib/material/phong', 'github:toji/gl-matrix@master'], function (_export) {
    var _inherits, _classCallCheck, _Promise, Scene, Geometry, Material, PhongMaterial, glm, vec3, mat4, buffer, Model;

    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsPromise) {
            _Promise = _npmBabelRuntime543CoreJsPromise['default'];
        }, function (_libSceneBase) {
            Scene = _libSceneBase['default'];
        }, function (_libGeometryGeometry) {
            Geometry = _libGeometryGeometry['default'];
        }, function (_libMaterialBase) {
            Material = _libMaterialBase.Material;
        }, function (_libMaterialPhong) {
            PhongMaterial = _libMaterialPhong['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }],
        execute: function () {
            'use strict';

            vec3 = glm.vec3;
            mat4 = glm.mat4;

            // 8 * vec3
            buffer = new Float64Array(24);

            /**
             * A node that represents a drawable entity.
             */

            Model = (function (_Scene) {
                function Model(name, options, geometry /*: Geometry|Promise<Geometry>*/) {
                    var _this = this;

                    var material /*: Material|Promise<Material>*/ = arguments[3] === undefined ? new PhongMaterial() : arguments[3];

                    _classCallCheck(this, Model);

                    _Scene.call(this, name, options);

                    this.geometry = geometry instanceof Geometry ? geometry : null;
                    this.material = material instanceof Material ? material : null;

                    this.onGeometryLoaded = _Promise.resolve(geometry).then(function (geometry) {
                        _this.geometry = geometry;
                        _this.dirty = true;
                        //this.recalculateAABB();
                        return geometry;
                    });

                    this.onMaterialLoaded = _Promise.resolve(material).then(function (material) {
                        return _this.material = material;
                    });

                    this.onReady = _Promise.all([this.onGeometryLoaded, this.onMaterialLoaded]).then(function () {
                        _this.processing = false;
                    });

                    this.mvpMatrix = mat4.create();

                    // Object.seal(this);
                }

                _inherits(Model, _Scene);

                Model.prototype.recalculate = function recalculate(existingNodes) {
                    var dirty = _Scene.prototype.recalculate.call(this, existingNodes);

                    if (dirty && this.geometry) {
                        buffer.set(this.geometry.bounds.points);
                        vec3.forEach(buffer, 0, 0, 0, vec3.transformMat4, this.worldTransform);

                        this.aabb.resetIntervals();
                        this.aabb.expandIntervals(buffer);
                        this.aabb.computePoints();
                    }

                    this.dirty = dirty;

                    return dirty;
                };

                return Model;
            })(Scene);

            _export('default', Model);
        }
    };
});
System.register('lib/renderer', ['npm:babel-runtime@5.4.3/helpers/inherits', 'npm:babel-runtime@5.4.3/helpers/class-call-check', 'npm:babel-runtime@5.4.3/core-js/promise', 'npm:babel-runtime@5.4.3/core-js/weak-map', 'npm:babel-runtime@5.4.3/core-js/get-iterator', 'npm:babel-runtime@5.4.3/core-js/weak-set', 'github:toji/gl-matrix@master', 'lib/extra/webgl-debug', 'lib/extra/event-aggregator', 'github:mrdoob/stats.js@master', 'lib/camera/base', 'lib/camera/perspective-camera', 'lib/scene/base', 'lib/scene/model', 'lib/scene/group', 'lib/light/base', 'lib/environment/environment', 'lib/extra/bitfield'], function (_export) {
    var _inherits, _classCallCheck, _Promise, _WeakMap, _getIterator, _WeakSet, glm, WebGLDebugUtils, EventAggregator, Stats, Camera, PerspectiveCamera, Scene, Model, Group, Light, Environment, Bitfield, mat4, GL, maskBuffer, stack, Renderer;

    function binarySearch(_x4, _x5, _x6, _x7, _x8) {
        var _again = true;

        _function: while (_again) {
            var element = _x4,
                array = _x5,
                comparator = _x6,
                start = _x7,
                end = _x8;
            pivot = undefined;
            _again = false;

            start = start || 0;
            end = end || array.length;
            var pivot = Math.floor(start + (end - start) / 2);
            if (array[pivot] === element) return pivot;
            if (end - start <= 1) {
                return array[pivot] > element ? pivot - 1 : pivot;
            }
            if (comparator(array[pivot], element) < 0) {
                _x4 = element;
                _x5 = array;
                _x6 = comparator;
                _x7 = pivot;
                _x8 = end;
                _again = true;
                continue _function;
            } else {
                _x4 = element;
                _x5 = array;
                _x6 = comparator;
                _x7 = start;
                _x8 = pivot;
                _again = true;
                continue _function;
            }
        }
    }

    function insertSorted(element, array, comparator) {
        array.splice(binarySearch(element, array, comparator) + 1, 0, element);
        return array;
    }

    function makeDebug(context) {
        return WebGLDebugUtils.makeDebugContext(context, function (err, funcName) {
            console.error('' + WebGLDebugUtils.glEnumToString(err) + ' was caused by call to: ' + funcName);
        }, function (functionName, args) {
            console.log('gl.' + functionName + '(' + WebGLDebugUtils.glFunctionArgsToString(functionName, args) + ')');
            for (var _iterator2 = args, _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _getIterator(_iterator2);;) {
                var _ref2;

                if (_isArray2) {
                    if (_i2 >= _iterator2.length) break;
                    _ref2 = _iterator2[_i2++];
                } else {
                    _i2 = _iterator2.next();
                    if (_i2.done) break;
                    _ref2 = _i2.value;
                }

                var arg = _ref2;

                if (arg === undefined) console.error('undefined passed to gl.' + functionName + '(' + WebGLDebugUtils.glFunctionArgsToString(functionName, args) + ')');
            }
        });
    }
    return {
        setters: [function (_npmBabelRuntime543HelpersInherits) {
            _inherits = _npmBabelRuntime543HelpersInherits['default'];
        }, function (_npmBabelRuntime543HelpersClassCallCheck) {
            _classCallCheck = _npmBabelRuntime543HelpersClassCallCheck['default'];
        }, function (_npmBabelRuntime543CoreJsPromise) {
            _Promise = _npmBabelRuntime543CoreJsPromise['default'];
        }, function (_npmBabelRuntime543CoreJsWeakMap) {
            _WeakMap = _npmBabelRuntime543CoreJsWeakMap['default'];
        }, function (_npmBabelRuntime543CoreJsGetIterator) {
            _getIterator = _npmBabelRuntime543CoreJsGetIterator['default'];
        }, function (_npmBabelRuntime543CoreJsWeakSet) {
            _WeakSet = _npmBabelRuntime543CoreJsWeakSet['default'];
        }, function (_githubTojiGlMatrixMaster) {
            glm = _githubTojiGlMatrixMaster['default'];
        }, function (_libExtraWebglDebug) {
            WebGLDebugUtils = _libExtraWebglDebug['default'];
        }, function (_libExtraEventAggregator) {
            EventAggregator = _libExtraEventAggregator['default'];
        }, function (_githubMrdoobStatsJsMaster) {
            Stats = _githubMrdoobStatsJsMaster['default'];
        }, function (_libCameraBase) {
            Camera = _libCameraBase['default'];
        }, function (_libCameraPerspectiveCamera) {
            PerspectiveCamera = _libCameraPerspectiveCamera['default'];
        }, function (_libSceneBase) {
            Scene = _libSceneBase['default'];
        }, function (_libSceneModel) {
            Model = _libSceneModel['default'];
        }, function (_libSceneGroup) {
            Group = _libSceneGroup['default'];
        }, function (_libLightBase) {
            Light = _libLightBase.Light;
        }, function (_libEnvironmentEnvironment) {
            Environment = _libEnvironmentEnvironment['default'];
        }, function (_libExtraBitfield) {
            Bitfield = _libExtraBitfield['default'];
        }],
        execute: function () {
            'use strict';

            mat4 = glm.mat4;
            GL = WebGLRenderingContext;

            // Super small buffer to capture second return value during frustum culling
            maskBuffer = new Uint8Array(1);
            stack = [];

            Renderer = (function (_EventAggregator) {
                function Renderer(scene, camera, canvas) {
                    var _this = this;

                    var _ref3 = arguments[3] === undefined ? {} : arguments[3];

                    var _ref3$environment = _ref3.environment;
                    var environment = _ref3$environment === undefined ? 0 : _ref3$environment;
                    var _ref3$debug = _ref3.debug;
                    var debug = _ref3$debug === undefined ? false : _ref3$debug;
                    var _ref3$showFPS = _ref3.showFPS;
                    var showFPS = _ref3$showFPS === undefined ? false : _ref3$showFPS;
                    var _ref3$hidpi = _ref3.hidpi;
                    var hidpi = _ref3$hidpi === undefined ? true : _ref3$hidpi;
                    var _ref3$antialias = _ref3.antialias;
                    var antialias = _ref3$antialias === undefined ? true : _ref3$antialias;
                    var _ref3$fullscreen = _ref3.fullscreen;
                    var fullscreen = _ref3$fullscreen === undefined ? true : _ref3$fullscreen;

                    _classCallCheck(this, Renderer);

                    _EventAggregator.call(this);

                    this.scene = scene;
                    this.camera = camera;
                    this.canvas = canvas;

                    _Promise.resolve(environment).then(function (environment) {
                        _this.environment = environment instanceof Environment ? environment : new Environment({ ambient: environment });
                        _this.environment.initialize(_this);
                    });

                    this._activeModels = [];
                    this._geometryRenderers = [];
                    this._materialRenderers = [];
                    this._lightRenderers = [];

                    this._materialsUsingGeometry = new _WeakMap();

                    this._newNodes = new Bitfield();
                    this._processedNodes = new Bitfield();
                    this._visibleNodes = new Bitfield();

                    var pixelRatio = hidpi ? devicePixelRatio : 1;

                    canvas.width = Math.round(canvas.clientWidth * pixelRatio);
                    canvas.height = Math.round(canvas.clientHeight * pixelRatio);

                    var gl = canvas.getContext('webgl', { antialias: antialias }) || canvas.getContext('experimental-webgl', { antialias: antialias });

                    if (gl === undefined) {
                        throw 'Your browser does not seem to support WebGL! Too bad!';
                    }

                    if (debug) {
                        gl = makeDebug(gl);
                    }

                    if (showFPS) {
                        var stats = new Stats();
                        stats.setMode(0);
                        stats.domElement.style.position = 'absolute';
                        stats.domElement.style.left = '0px';
                        stats.domElement.style.top = '0px';
                        document.body.appendChild(stats.domElement);

                        this._stats = stats;
                    }

                    if (fullscreen && camera instanceof PerspectiveCamera) {
                        camera.aspect = canvas.clientWidth / canvas.clientHeight;

                        window.addEventListener('resize', function () {
                            canvas.width = Math.round(canvas.clientWidth * pixelRatio);
                            canvas.height = Math.round(canvas.clientHeight * pixelRatio);
                            gl.viewport(0, 0, canvas.width, canvas.height);
                            camera.aspect = canvas.clientWidth / canvas.clientHeight;
                        });
                    }

                    this.gl = gl;

                    var firstBy = function firstBy(f) {
                        f.thenBy = function (g) {
                            return firstBy(function (a, b) {
                                return f(a, b) || g(a, b);
                            });
                        };
                        return f;
                    };

                    var comparing = function comparing(f) {
                        var cmp = arguments[1] === undefined ? function (a, b) {
                            return b - a;
                        } : arguments[1];
                        return function (lhs, rhs) {
                            return cmp(f(lhs), f(rhs));
                        };
                    };

                    var compareObjects = function compareObjects(a, b) {
                        return a === b ? 0 : -1;
                    };

                    this._modelComparator = firstBy(comparing(function (id) {
                        return _this._materialRenderers[id].program;
                    }, compareObjects)).thenBy(comparing(function (id) {
                        return Scene.instances[id].material;
                    }, compareObjects));

                    this.start = this.start.bind(this);
                    this._processNode = this._processNode.bind(this);

                    gl.enable(GL.DEPTH_TEST);
                    gl.enable(GL.CULL_FACE);
                    gl.cullFace(GL.BACK);
                }

                _inherits(Renderer, _EventAggregator);

                /**
                 * Starts the render loop.
                 */

                Renderer.prototype.start = function start() {
                    var elapsedTime = arguments[0] === undefined ? 0 : arguments[0];

                    var lastTime = this._lastTime || 0;
                    this.render(elapsedTime - lastTime, elapsedTime);
                    this._lastTime = elapsedTime;
                    this._animationFrame = window.requestAnimationFrame(this.start);
                };

                /**
                 * Stops the render loop.
                 */

                Renderer.prototype.stop = function stop() {
                    if (this._animationFrame) {
                        window.cancelAnimationFrame(this._animationFrame);
                    }
                };

                Renderer.prototype._processNode = function _processNode(id) {
                    var node = Scene.instances[id];

                    if (node instanceof Model) {
                        this._processModel(node);
                    } else if (node instanceof Light) {
                        this._lightRenderers.push(node.getRenderer(this.gl));

                        // Recompile all shaders with new inputs
                        for (var _iterator = this._materialRenderers, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _getIterator(_iterator);;) {
                            var _ref;

                            if (_isArray) {
                                if (_i >= _iterator.length) break;
                                _ref = _iterator[_i++];
                            } else {
                                _i = _iterator.next();
                                if (_i.done) break;
                                _ref = _i.value;
                            }

                            var materialRenderer = _ref;

                            materialRenderer.init(this);
                        }
                    }
                };

                /**
                 * Processes a model in the scene graph, creating renderers for geometry and material as soon as they are resolved.
                 */

                Renderer.prototype._processModel = function _processModel(model) {
                    var _this2 = this;

                    model.onReady.then(function () {
                        var geometryRenderer = model.geometry.getRenderer(_this2.gl);
                        var materialRenderer = model.material.getRenderer(_this2.gl);
                        materialRenderer.init(_this2);

                        _this2._geometryRenderers[model.id] = geometryRenderer;
                        _this2._materialRenderers[model.id] = materialRenderer;

                        var materials = _this2._materialsUsingGeometry.get(model.geometry);
                        if (materials === undefined) {
                            materials = new _WeakSet();
                            _this2._materialsUsingGeometry.set(model.geometry, new _WeakSet());
                        }
                        if (!materials.has(model.material)) {
                            materialRenderer.setGeometryRenderer(geometryRenderer);
                            materials.add(model.material);
                        }

                        if (_this2._activeModels.indexOf(model.id) !== -1) debugger;

                        insertSorted(model.id, _this2._activeModels, _this2._modelComparator);

                        model.dirty = true;

                        return model;
                    });
                };

                Renderer.prototype._markVisibleNodes = function _markVisibleNodes(node) {
                    var camera = this.camera;
                    var visibleNodes = this._visibleNodes;
                    var i = 0;

                    stack[i++] = node;
                    stack[i++] = 63;

                    var result = undefined,
                        outMask = undefined;

                    do {
                        maskBuffer[0] = stack[--i];
                        node = stack[--i];

                        result = camera.canSee(node, maskBuffer);
                        outMask = maskBuffer[0];

                        switch (result) {
                            case 1:
                                // Inside, set entire subtree visible
                                for (var j = 0, ids = node.subtreeIds, len = ids.length; j < len; ++j) {
                                    visibleNodes.set(ids[j]);
                                }

                                break;
                            case 2:
                                // Intersect, keep looking
                                //node.visible = true;
                                visibleNodes.set(node.id);
                                if (node instanceof Group) {
                                    for (var j = 0, len = node.children.length; j < len; ++j) {
                                        stack[i++] = node.children[j];
                                        stack[i++] = outMask;
                                    }
                                }
                        }
                    } while (i > 0);
                };

                /**
                 * Renders one frame of the scene graph to the bound WebGL context.
                 */

                Renderer.prototype.render = function render(deltaTime, elapsedTime) {
                    if (this._stats) this._stats.begin();

                    // Don't actually know if caching these make any difference...
                    var scene = this.scene;
                    var camera = this.camera;
                    var geometryRenderers = this._geometryRenderers;
                    var materialRenderers = this._materialRenderers;
                    var activeModelsIds = this._activeModels;
                    var visibleNodes = this._visibleNodes;
                    var newNodes = this._newNodes;
                    var processedNodes = this._processedNodes;
                    var nodes = Scene.instances;

                    // Trigger render loop callbacks
                    this.trigger('tick', { sync: true }, deltaTime, elapsedTime);

                    // Recompute entire scene, and also collect a bitfield of found nodes
                    var dirtyScene = scene.recalculate(newNodes);

                    // Diff the found nodes with the already processed nodes, yielding the new nodes
                    newNodes.diff(processedNodes, newNodes);

                    // Process any new nodes
                    newNodes.forEach(this._processNode);

                    // If any new nodes are found
                    if (!newNodes.isEmpty) {
                        scene.recalculateSubtreeIds();
                    }

                    // Merge the new nodes with the set of processed nodes
                    processedNodes.union(newNodes, processedNodes);

                    // Don't rerender if nothing has changed
                    if (!dirtyScene) return;

                    // Mark visible nodes (frustum culling)
                    this._markVisibleNodes(scene);

                    if (this.environment) this.environment.render(this);

                    var id = undefined,
                        lastProgram = undefined,
                        lastMaterialRenderer = undefined,
                        geometryRenderer = undefined,
                        materialRenderer = undefined,
                        program = undefined,
                        model = undefined;

                    for (var i = 0, len = activeModelsIds.length; i < len; ++i) {

                        id = activeModelsIds[i];
                        model = nodes[id];

                        if (visibleNodes.get(id)) {

                            if (camera.dirty || model.dirty) {
                                mat4.multiply(model.mvpMatrix, camera.cameraMatrix, model.worldTransform);
                            }

                            geometryRenderer = geometryRenderers[id];
                            materialRenderer = materialRenderers[id];
                            program = materialRenderer.program;

                            if (program !== lastProgram) {
                                program.use();
                            }

                            if (materialRenderer !== lastMaterialRenderer) {
                                materialRenderer.beforeRender(this);
                            }

                            materialRenderer.render(model, this);

                            geometryRenderer.render(this);

                            if (materialRenderer !== lastMaterialRenderer) {
                                materialRenderer.afterRender(this);
                            }

                            lastProgram = program;
                            lastMaterialRenderer = materialRenderer;
                        }

                        model.dirty = false;
                    }

                    camera.dirty = false;

                    if (this.environment) this.environment.renderLast(this);

                    // Reset bitfields without allocating new objects
                    visibleNodes.reset();
                    newNodes.reset();

                    if (this._stats) this._stats.end();
                };

                return Renderer;
            })(EventAggregator);

            _export('default', Renderer);
        }
    };
});
System.register('lib/tribus', ['lib/renderer', 'lib/extra/helpers', 'lib/scene/base', 'lib/scene/group', 'lib/scene/model', 'lib/control/mouseview', 'lib/light/directional-light', 'lib/light/pointlight', 'lib/light/spotlight', 'lib/camera/perspective-camera', 'lib/camera/orthographic-camera', 'lib/geometry/geometry', 'lib/geometry/shapes', 'lib/texture/texture2d', 'lib/texture/cubemap', 'lib/environment/skybox', 'lib/material/phong', 'lib/webgl/program', 'lib/webgl/shader', 'lib/webgl/buffer'], function (_export) {
  /**
   * tribus.js
   */

  'use strict';

  // "*" doesn't work anymore for bundle-sfx, bug?
  return {
    setters: [function (_libRenderer) {
      _export('Renderer', _libRenderer['default']);
    }, function (_libExtraHelpers) {
      _export('terrain', _libExtraHelpers.terrain);

      _export('cube', _libExtraHelpers.cube);

      _export('plane', _libExtraHelpers.plane);

      _export('camera', _libExtraHelpers.camera);

      _export('pointlight', _libExtraHelpers.pointlight);

      _export('spotlight', _libExtraHelpers.spotlight);

      _export('geometry', _libExtraHelpers.geometry);

      _export('texture2d', _libExtraHelpers.texture2d);

      _export('cubemap', _libExtraHelpers.cubemap);

      _export('phong', _libExtraHelpers.phong);

      _export('model', _libExtraHelpers.model);

      _export('group', _libExtraHelpers.group);
    }, function (_libSceneBase) {
      _export('Scene', _libSceneBase['default']);
    }, function (_libSceneGroup) {
      _export('Group', _libSceneGroup['default']);
    }, function (_libSceneModel) {
      _export('Model', _libSceneModel['default']);
    }, function (_libControlMouseview) {
      _export('MouseViewController', _libControlMouseview['default']);
    }, function (_libLightDirectionalLight) {
      _export('DirectionalLight', _libLightDirectionalLight['default']);
    }, function (_libLightPointlight) {
      _export('PointLight', _libLightPointlight['default']);
    }, function (_libLightSpotlight) {
      _export('SpotLight', _libLightSpotlight['default']);
    }, function (_libCameraPerspectiveCamera) {
      _export('PerspectiveCamera', _libCameraPerspectiveCamera['default']);
    }, function (_libCameraOrthographicCamera) {
      _export('OrthographicCamera', _libCameraOrthographicCamera['default']);
    }, function (_libGeometryGeometry) {
      _export('Geometry', _libGeometryGeometry['default']);
    }, function (_libGeometryShapes) {
      _export('Cube', _libGeometryShapes.Cube);

      _export('Plane', _libGeometryShapes.Plane);
    }, function (_libTextureTexture2d) {
      _export('Texture2D', _libTextureTexture2d['default']);
    }, function (_libTextureCubemap) {
      _export('CubeMap', _libTextureCubemap['default']);
    }, function (_libEnvironmentSkybox) {
      _export('Skybox', _libEnvironmentSkybox['default']);
    }, function (_libMaterialPhong) {
      _export('PhongMaterial', _libMaterialPhong['default']);
    }, function (_libWebglProgram) {
      _export('GLProgram', _libWebglProgram['default']);
    }, function (_libWebglShader) {
      _export('GLShader', _libWebglShader['default']);
    }, function (_libWebglBuffer) {
      _export('GLBuffer', _libWebglBuffer['default']);
    }],
    execute: function () {}
  };
});
System.register('lib/extra/exporter', ['lib/tribus'], function (_export) {
    'use strict';

    var Tribus;
    return {
        setters: [function (_libTribus) {
            Tribus = _libTribus;
        }],
        execute: function () {

            // CommonJS exporter
            if (typeof module !== 'undefined') {
                module.exports = Tribus;
            } else {
                window.Tribus = Tribus;
            }
        }
    };
});
});
//# sourceMappingURL=tribus.js.map