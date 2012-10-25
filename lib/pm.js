
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const URL_PROXY_CACHE = require("sourcemint-util-js/lib/url-proxy-cache");
const Q = require("sourcemint-util-js/lib/q");
const TERM = require("sourcemint-util-js/lib/term");
const UTIL = require("sourcemint-util-js/lib/util");
const SM_PM = require("sourcemint-pm-sm/lib/pm");
const SPAWN = require("child_process").spawn;
const FS_RECURSIVE = require("sourcemint-util-js/lib/fs-recursive");


exports.install = function(pm, options) {

    ASSERT(typeof options.locator !== "undefined", "'options.locator' required!");

    var cache = new URL_PROXY_CACHE.UrlProxyCache(PATH.join(pm.context.homeBasePath, "url-cache"), {
        verbose: options.verbose,
        ttl: 0    // Indefinite
    });
    var url = options.locator;

    var installCachePath = PATH.join(pm.context.homeBasePath, "install-cache");
    // TODO: Include `configure` options from locator to determine cache path.
    var cachePath = PATH.join(installCachePath, url.replace(/[:@#]/g, "/").replace(/\/+/g, "/"));
    var cacheExisted = PATH.existsSync(cachePath);
    var path = pm.context.package.path;


    function installGlobal(cachePath, status) {

        if (status === 304) {
            return Q.call(function() {
                return cachePath;
            });
        }

        function run(command) {
            var deferred = Q.defer();
            if (options.verbose) TERM.stdout.writenl("\0cyan(Running: " + command + " (cwd: " + cachePath + ")\0)");
            var proc = SPAWN(command.split(" ").shift(), command.split(" ").slice(1), {
                cwd: cachePath
            });
            proc.on("error", function(err) {
                deferred.reject(err);
            });
            var buffer = "";
            proc.stdout.on("data", function(data) {
                if (options.verbose) {
                    TERM.stdout.write(data.toString());
                }
                buffer += data.toString();
            });
            proc.stderr.on("data", function(data) {
                if (options.verbose) {
                    TERM.stderr.write(data.toString());
                }
                buffer += data.toString();
            });
            proc.on("exit", function(code) {
                if (code !== 0) {
                    if (!options.verbose) {
                        TERM.stderr.write("\0red(" + buffer + "\0)");
                    }
                    return deferred.reject(new Error("Error running: " + command));
                }
                deferred.resolve();
            });
            return deferred.promise;
        }

        TERM.stdout.writenl("\0cyan([sm] Installing in cache: " + cachePath + "\0)");

        // TODO: Include `configure` options from locator (which are part of unique version identifier).
        return run("./configure").then(function() {
            return run("make");
        }).fail(function(err) {
            // TODO: Instead of deleting failed install here we should copy it to archive so it can be inspected.
            FS_RECURSIVE.rmdirSyncRecursive(cachePath);
            throw err;
        });
    }

    function install(cachePath, status) {
        return installGlobal(cachePath, status).then(function(cachePath) {

            if (PATH.existsSync(path)) {
                var backupPath = path + "~backup-" + new Date().getTime();
                if (options.verbose) TERM.stdout.writenl("\0cyan(" + "Backing up '" + path + "' to '" + backupPath + "'." + "\0)");
                FS.renameSync(path, backupPath);
            }
            FS_RECURSIVE.mkdirSyncRecursive(path);

            if (options.verbose) TERM.stdout.writenl("\0cyan(Copying cached install from '" + cachePath + "' to '" + path + "'.\0)");

            return FS_RECURSIVE.osCopyDirRecursive(cachePath, path).then(function() {
                
                if (PATH.existsSync(PATH.join(path, ".git"))) {
                    if (options.verbose) TERM.stdout.writenl("\0cyan(Deleting git version control for package '" + path + "' to put it into read only mode.\0)");

                    FS_RECURSIVE.rmdirSyncRecursive(PATH.join(path, ".git"));
                }
            }).fail(function(err) {
                if (PATH.existsSync(path)) {
                    FS_RECURSIVE.rmdirSyncRecursive(path);
                }
                throw err;
            });
        });
    }

    return Q.call(function() {
        if (/\.tar\.gz$/.test(url)) {
            return SM_PM.forPackagePath(cachePath, pm).then(function(pm) {
                var opts = UTIL.copy(options);
                opts.force = false;
                opts.pm = "tar";
                return pm.install(opts).then(function(status) {
                    // Force a cache install if cache did not exist prior.
                    if (!cacheExisted) {
                        status = 200;
                    }
                    if (status === 200 || !PATH.existsSync(path) || options.force === true) {
                        return install(cachePath, status);
                    }
                });
            });
        } else {
            throw new Error("Archive type not yet supported: " + url);
        }
    });
}

