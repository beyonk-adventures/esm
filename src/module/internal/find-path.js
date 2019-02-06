// Based on `Module._findPath()`.
// Copyright Node.js contributors. Released under MIT license:
// https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js

import { basename, dirname, resolve, sep } from "../../safe/path.js"

import CHAR_CODE from "../../constant/char-code.js"
import ENV from "../../constant/env.js"

import GenericArray from "../../generic/array.js"
import Module from "../../module.js"
import { Stats } from "../../safe/fs.js"

import isAbsolute from "../../path/is-absolute.js"
import isJS from "../../path/is-js.js"
import isMJS from "../../path/is-mjs.js"
import isSep from "../../path/is-sep.js"
import keys from "../../util/keys.js"
import readPackage from "./read-package.js"
import realpath from "../../fs/realpath.js"
import shared from "../../shared.js"
import statFast from "../../fs/stat-fast.js"
import statSync from "../../fs/stat-sync.js"

const {
  DOT
} = CHAR_CODE

const {
  FLAGS,
  TINK,
  YARN_PNP
} = ENV

const { isFile } = Stats.prototype
const mainFields = ["main"]

const preserveAllSymlinks =
  TINK ||
  YARN_PNP

const resolveSymlinks =
  ! preserveAllSymlinks &&
  ! FLAGS.preserveSymlinks

const resolveSymlinksMain =
  ! preserveAllSymlinks &&
  ! FLAGS.preserveSymlinksMain

function findPath(request, paths, isMain = false, fields, exts) {
  let cacheKey = request + "\0"

  if (paths) {
    cacheKey += paths.length === 1 ? paths[0] : GenericArray.join(paths)
  }

  cacheKey += "\0"

  if (fields) {
    cacheKey += fields.length === 1 ? fields[0] : fields.join()
  }

  cacheKey += "\0"

  if (exts) {
    cacheKey += exts.length === 1 ? exts[0] : exts.join()
  }

  cacheKey += "\0"

  if (isMain) {
    cacheKey += "1"
  }

  const cache = shared.memoize.moduleInternalFindPath
  const cached = cache.get(cacheKey)

  if (cached !== void 0) {
    return cached
  }

  const isAbs = isAbsolute(request)

  if (isAbs) {
    paths = [""]
  } else if (! Array.isArray(paths) ||
      paths.length === 0) {
    return ""
  }

  let trailingSlash = request !== ""

  if (trailingSlash) {
    let code = request.charCodeAt(request.length - 1)

    if (code === DOT) {
      code = request.charCodeAt(request.length - 2)

      if (code === DOT) {
        code = request.charCodeAt(request.length - 3)
      }
    }

    trailingSlash = isSep(code)
  }

  const useRealpath = isMain
    ? resolveSymlinksMain
    : resolveSymlinks

  for (let curPath of paths) {
    if (typeof curPath === "string" &&
        curPath !== "" &&
        statFast(curPath) !== 1) {
      continue
    }

    if (useRealpath) {
      if (isAbs) {
        curPath = dirname(request)
        request = basename(request)
      }

      curPath = realpath(curPath)

      if (curPath === "") {
        continue
      }
    }

    let thePath

    if (isAbs) {
      thePath = useRealpath
        ? curPath + sep + request
        : request
    } else {
      thePath = resolve(curPath, request)
    }

    let rc = -1
    let stat = null

    if (isJS(thePath) ||
        isMJS(thePath)) {
      stat = statSync(thePath)

      if (stat !== null) {
        rc = Reflect.apply(isFile, stat, []) ? 0 : 1
      }
    } else {
      rc = statFast(thePath)
    }

    let filename = ""

    if (! trailingSlash) {
      // If a file.
      if (rc === 0) {
        filename = useRealpath
          ? realpath(thePath)
          : thePath
      }

      if (filename === "") {
        if (exts === void 0) {
          exts = keys(Module._extensions)
        }

        filename = tryExtensions(thePath, exts, isMain)
      }
    }

    // If a directory.
    if (rc === 1 &&
        filename === "") {
      if (exts === void 0) {
        exts = keys(Module._extensions)
      }

      if (fields === void 0) {
        fields = mainFields
      }

      filename = tryPackage(thePath, fields, exts, isMain)

      if (filename === "") {
        filename = tryExtensions(thePath + sep + "index", exts, isMain)
      }
    }

    if (filename !== "") {
      cache.set(cacheKey, filename)
      return filename
    }
  }

  return ""
}

function tryExtensions(thePath, exts, isMain) {
  for (const ext of exts) {
    const filename = tryFilename(thePath + ext, isMain)

    if (filename !== "") {
      return filename
    }
  }

  return ""
}

function tryField(dirPath, fieldPath, exts, isMain) {
  if (typeof fieldPath !== "string") {
    return ""
  }

  const thePath = resolve(dirPath, fieldPath)

  let filename = tryFilename(thePath, isMain)

  if (filename === "") {
    filename = tryExtensions(thePath, exts, isMain)
  }

  if (filename === "") {
    filename = tryExtensions(thePath + sep + "index", exts, isMain)
  }

  return filename
}

function tryFilename(filename, isMain) {
  let rc = -1

  if (isJS(filename) ||
      isMJS(filename)) {
    let stat = statSync(filename)

    if (stat !== null) {
      rc = Reflect.apply(isFile, stat, []) ? 0 : 1
    }
  } else {
    rc = statFast(filename)
  }

  if (rc) {
    return ""
  }

  const useRealpath = isMain
    ? resolveSymlinksMain
    : resolveSymlinks

  return useRealpath
    ? realpath(filename)
    : filename
}

function tryPackage(dirPath, fields, exts, isMain) {
  const json = readPackage(dirPath, fields)

  if (json === null) {
    return ""
  }

  for (const field of fields) {
    const filename = tryField(dirPath, json[field], exts, isMain)

    if (filename !== "" &&
        (field === "main" ||
         ! isMJS(filename))) {
      return filename
    }
  }

  return ""
}

export default findPath
