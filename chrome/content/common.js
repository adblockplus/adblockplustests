const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

const MILLIS_IN_SECOND = 1000;
const MILLIS_IN_MINUTE = 60 * MILLIS_IN_SECOND;
const MILLIS_IN_HOUR = 60 * MILLIS_IN_MINUTE;
const MILLIS_IN_DAY = 24 * MILLIS_IN_HOUR;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

function require(module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "adblockplus-require", module);
  return result.exports;
}

function getModuleGlobal(module)
{
  let result = Cu.getGlobalForObject(require(module));
  if (result == window)
  {
    // Work-around for bug 736316 - getGlobalForObject gave us our own window
    let {XPIProvider} = Cu.import("resource://gre/modules/XPIProvider.jsm", null);
    let addonID = "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}";
    if (addonID in XPIProvider.bootstrapScopes)
      result = XPIProvider.bootstrapScopes[addonID];
  }

  if ("require" in result)
    result = result.require.scopes[module];
  return result;
}

let {Filter, InvalidFilter, CommentFilter, ActiveFilter, RegExpFilter,
     BlockingFilter, WhitelistFilter, ElemHideBase, ElemHideFilter, ElemHideException} = require("filterClasses");
let {Subscription, SpecialSubscription, RegularSubscription,
     ExternalSubscription, DownloadableSubscription} = require("subscriptionClasses");
let {defaultMatcher, Matcher, CombinedMatcher} = require("matcher");
let {FilterListener} = require("filterListener");
let {FilterNotifier} = require("filterNotifier");
let {FilterStorage} = require("filterStorage");
let {ElemHide} = require("elemHide");
let {IO} = require("io");
let {Notification} = require("notification");
let {Prefs} = require("prefs");
let {RequestNotifier} = require("requestNotifier");
let {Synchronizer} = require("synchronizer");
let {UI} = require("ui");
let {Utils} = require("utils");

let geckoVersion = Services.appinfo.platformVersion;
function compareGeckoVersion(version)
{
  return Services.vc.compare(geckoVersion, version);
}

function prepareFilterComponents(keepListeners)
{
  let FilterNotifierGlobal = getModuleGlobal("filterNotifier");

  this._backup = {
    subscriptions: FilterStorage.subscriptions,
    storageKnown: FilterStorage.knownSubscriptions,
    subscriptionsKnown: Subscription.knownSubscriptions,
    filtersKnown: Filter.knownFilters,
    listeners: FilterNotifierGlobal.listeners,
    sourceFile: FilterStorage.sourceFile
  };

  FilterStorage.subscriptions = [];
  FilterStorage.knownSubscriptions = {__proto__: null};
  Subscription.knownSubscriptions = {__proto__: null};
  Filter.knownFilters = {__proto__: null};
  if (!keepListeners)
  {
    FilterNotifierGlobal.listeners = [];
  }

  defaultMatcher.clear();
  ElemHide.clear();

  try
  {
    // Disable timeline functions, they slow down tests otherwise
    let {TimeLine} = require("timeline");

    this._backup.timelineLog = TimeLine.log;
    this._backup.timelineEnter = TimeLine.enter;
    this._backup.timelineLeave = TimeLine.leave;

    TimeLine.log = function(){};
    TimeLine.enter = function(){};
    TimeLine.leave = function(){};
  }
  catch(e)
  {
    // TimeLine module might not be present, catch exceptions
  }
}

function restoreFilterComponents()
{
  let FilterNotifierGlobal = getModuleGlobal("filterNotifier");

  FilterStorage.subscriptions = this._backup.subscriptions;
  FilterStorage.knownSubscriptions = this._backup.storageKnown;
  Subscription.knownSubscriptions = this._backup.subscriptionsKnown;
  Filter.knownFilters = this._backup.filtersKnown;
  FilterNotifierGlobal.listeners = this._backup.listeners;
  FilterStorage.sourceFile = this._backup.sourceFile;

  scheduleReinit();

  if ("timelineLeave" in this._backup)
  {
    let {TimeLine} = require("timeline");

    TimeLine.log = this._backup.timelineLog;
    TimeLine.enter = this._backup.timelineEnter;
    TimeLine.leave = this._backup.timelineLeave;
  }
}

// Only reinit our data structures when all the tests are done to prevent
// slowing down text execution
let reinitScheduled = false;
function scheduleReinit()
{
  if (reinitScheduled)
    return;

  let origDone = QUnit.done;
  QUnit.done = function()
  {
    FilterNotifier.triggerListeners("load");
    return origDone.apply(this, arguments);
  };
  reinitScheduled = true;
}

function preparePrefs()
{
  this._pbackup = {__proto__: null};
  for (let pref in Prefs)
  {
    if (Prefs.__lookupSetter__(pref))
      this._pbackup[pref] = Prefs[pref];
  }
  Prefs.enabled = true;
}

function restorePrefs()
{
  for (let pref in this._pbackup)
    Prefs[pref] = this._pbackup[pref];
}

function setupVirtualTime(processTimers)
{
  let currentTime = 100000 * MILLIS_IN_HOUR;
  let startTime = currentTime;
  let scheduledTasks = [];

  let modules = Array.prototype.slice.call(arguments, 1);
  this._virtualTimeModules = modules;

  for (let module of this._virtualTimeModules)
  {
    let global = Cu.getGlobalForObject(getModuleGlobal(module));

    // Replace Date.now() function
    this["_origNow" + module] = global.Date.now;
    global.Date.now = function() currentTime;
  }

  // Wrap timers
  if (processTimers)
  {
    processTimers(function wrapTimer(timer)
    {
      let wrapper = {__proto__: timer};
      let callback = timer.callback;
      wrapper.handler = function() callback.notify(wrapper);
      wrapper.nextExecution = currentTime + timer.delay;
      scheduledTasks.push(wrapper);
      timer.cancel();
      return wrapper;
    });
  }

  // Register observer to track outstanding requests
  this._outstandingRequests = 0;
  this.observe = function(subject, topic, data)
  {
    let orig = this._outstandingRequests;
    if (topic == "http-on-modify-request")
      this._outstandingRequests++;
    else if (topic == "http-on-examine-response")
      this._outstandingRequests--;
  };
  this.QueryInterface = XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]);
  Services.obs.addObserver(this, "http-on-modify-request", true);
  Services.obs.addObserver(this, "http-on-examine-response", true);

  this.runScheduledTasks = function(maxHours, initial, skip)
  {
    if (typeof maxHours != "number")
      throw new Error("Numerical parameter expected");
    if (typeof initial != "number")
      initial = 0;
    if (typeof skip != "number")
      skip = 0;

    startTime = currentTime;
    if (initial >= 0)
    {
      this._runScheduledTasks(initial);
      maxHours -= initial;
    }
    if (skip)
    {
      this._skipTasks(skip);
      maxHours -= skip;
    }
    this._runScheduledTasks(maxHours);
  }

  this._runScheduledTasks = function(maxHours)
  {
    let endTime = currentTime + maxHours * MILLIS_IN_HOUR;
    while (true)
    {
      let nextTask = null;
      for (let task of scheduledTasks)
      {
        if (!nextTask || nextTask.nextExecution > task.nextExecution)
          nextTask = task;
      }
      if (!nextTask || nextTask.nextExecution > endTime)
        break;

      currentTime = nextTask.nextExecution;
      nextTask.handler();

      // Let all asynchronous actions finish
      let thread = Services.tm.currentThread;
      let loopStartTime = Date.now();

      while (this._outstandingRequests > 0 || thread.hasPendingEvents())
      {
        thread.processNextEvent(true);

        if (Date.now() - loopStartTime > 5000)
          throw new Error("Test stuck in a download loop");
      }

      if (nextTask.type == Components.interfaces.nsITimer.TYPE_ONE_SHOT)
        scheduledTasks = scheduledTasks.filter(function(task) task != nextTask);
      else
        nextTask.nextExecution = currentTime + nextTask.delay;
    }

    currentTime = endTime;
  }

  this._skipTasks = function(hours)
  {
    let newTasks = [];
    currentTime += hours * MILLIS_IN_HOUR;
    for (let task of scheduledTasks)
    {
      if (task.nextExecution >= currentTime)
        newTasks.push(task);
      else if (task.type != Components.interfaces.nsITimer.TYPE_ONE_SHOT)
      {
        task.nextExecution = currentTime;
        newTasks.push(task);
      }
    }
    scheduledTasks = newTasks;
  }

  this.getTimeOffset = function() (currentTime - startTime) / MILLIS_IN_HOUR;

  this.__defineGetter__("currentTime", function() currentTime);
}

function restoreVirtualTime()
{
  for (let module of this._virtualTimeModules)
  {
    let global = Cu.getGlobalForObject(getModuleGlobal(module));

    // Restore Date.now() function
    if ("_origNow" + module in this)
    {
      global.Date.now = this["_origNow" + module];
      delete this["_origNow" + module];
    }
  }

  Services.obs.removeObserver(this, "http-on-modify-request", true);
  Services.obs.removeObserver(this, "http-on-examine-response", true);
}

function setupVirtualXMLHttp()
{
  let host = "http://example.com";
  let requestHandlers = {};

  let XMLHttpRequest = function()
  {
    this._loadHandlers = [];
    this._errorHandlers = [];
  };
  XMLHttpRequest.prototype = {
    _path: null,
    _data: null,
    _queryString: null,
    _loadHandlers: null,
    _errorHandlers: null,
    status: 0,
    readyState: 0,
    responseText: null,

    addEventListener: function(eventName, handler, capture)
    {
      let list;
      if (eventName == "load")
        list = this._loadHandlers;
      else if (eventName == "error")
        list = this._errorHandlers;
      else
        throw new Error("Event type " + eventName + " not supported");

      if (list.indexOf(handler) < 0)
        list.push(handler);
    },

    removeEventListener: function(eventName, handler, capture)
    {
      let list;
      if (eventName == "load")
        list = this._loadHandlers;
      else if (eventName == "error")
        list = this._errorHandlers;
      else
        throw new Error("Event type " + eventName + " not supported");

      let index = list.indexOf(handler);
      if (index >= 0)
        list.splice(index, 1);
    },

    open: function(method, url, async, user, password)
    {
      if (method != "GET")
        throw new Error("Only GET requests are currently supported");
      if (typeof async != "undefined" && !async)
        throw new Error("Sync requests are not supported");
      if (typeof user != "undefined" || typeof password != "undefined")
        throw new Error("User authentification is not supported");

      let match = /^data:[^,]+,/.exec(url);
      if (match)
      {
        this._data = decodeURIComponent(url.substr(match[0].length));
        return;
      }

      if (url.substr(0, host.length) != host)
        throw new Error("Unexpected URL: " + url + " (URL starting with " + host + "expected)");

      this._path = url.substr(host.length);

      let queryIndex = this._path.indexOf("?");
      this._queryString = "";
      if (queryIndex >= 0)
      {
        this._queryString = this._path.substr(queryIndex + 1);
        this._path = this._path.substr(0, queryIndex);
      }
    },

    send: function(data)
    {
      if (!this._data && !this._path)
        throw new Error("No request path set");
      if (typeof data != "undefined" && data)
        throw new Error("Sending data to server is not supported");

      Utils.runAsync(function()
      {
        let result = [Cr.NS_OK, 404, ""];
        if (this._data)
          result = [Cr.NS_OK, 0, this._data];
        else if (this._path in requestHandlers)
          result = requestHandlers[this._path]({method: "GET", path: this._path, queryString: this._queryString});
        [this.channel.status, this.channel.responseStatus, this.responseText] = result;
        this.status = this.channel.responseStatus;

        let eventName = (this.channel.status == Cr.NS_OK ? "load" : "error");
        let event = {type: eventName};
        for (let handler of this["_" + eventName + "Handlers"])
          handler.call(this, event);
      }.bind(this));
    },

    overrideMimeType: function(mime)
    {
    },

    channel:
    {
      status: -1,
      responseStatus: 0,
      loadFlags: 0,
      INHIBIT_CACHING: 0,
      VALIDATE_ALWAYS: 0,
      QueryInterface: function() this
    }
  }

  this.registerHandler = function(path, handler) requestHandlers[path] = handler;

  let modules = Array.prototype.slice.call(arguments, 1);
  this._virtualXMLHttpModules = modules;
  for (let module of this._virtualTimeModules)
  {
    let global = getModuleGlobal(module);

    // Replace XMLHttpRequest constructor
    this["_origXMLHttpRequest" + module] = global.XMLHttpRequest;
    global.XMLHttpRequest = XMLHttpRequest;
  }
}

function restoreVirtualXMLHttp()
{
  for (let module of this._virtualXMLHttpModules)
  {
    let global = getModuleGlobal(module);

    // Restore XMLHttpRequest constructor
    if ("_origXMLHttpRequest" + module in this)
    {
      global.XMLHttpRequest = this["_origXMLHttpRequest" + module];
      delete this["_origXMLHttpRequest" + module];
    }
  }
}

function showProfilingData(debuggerService)
{
  let scripts = [];
  debuggerService.enumerateScripts({
    enumerateScript: function(script)
    {
      scripts.push(script);
    }
  });
  scripts = scripts.filter(function(script)
  {
    return script.fileName.indexOf("chrome://adblockplus/") == 0 && script.callCount > 0;
  });
  scripts.sort(function(a, b)
  {
    return b.totalOwnExecutionTime - a.totalOwnExecutionTime;
  });

  let table = document.createElement("table");
  table.setAttribute("border", "border");

  let header = table.insertRow(-1);
  header.style.fontWeight = "bold";
  header.insertCell(-1).textContent = "Function name";
  header.insertCell(-1).textContent = "Call count";
  header.insertCell(-1).textContent = "Min execution time (total/own)";
  header.insertCell(-1).textContent = "Max execution time (total/own)";
  header.insertCell(-1).textContent = "Total execution time (total/own)";

  for (let script of scripts)
    showProfilingDataForScript(script, table);

  document.getElementById("display").appendChild(table);
}

function showProfilingDataForScript(script, table)
{
  let functionName = script.functionName;
  if (functionName == "anonymous")
    functionName = guessFunctionName(script.fileName, script.baseLineNumber);

  let row = table.insertRow(-1);
  row.insertCell(-1).innerHTML = functionName + "<br/>\n" + script.fileName.replace("chrome://adblockplus/", "") + ":" + script.baseLineNumber;
  row.insertCell(-1).textContent = script.callCount;
  row.insertCell(-1).textContent = script.minExecutionTime.toFixed(2) + "/" + script.minOwnExecutionTime.toFixed(2);
  row.insertCell(-1).textContent = script.maxExecutionTime.toFixed(2) + "/" + script.maxOwnExecutionTime.toFixed(2);
  row.insertCell(-1).textContent = script.totalExecutionTime.toFixed(2) + "/" + script.totalOwnExecutionTime.toFixed(2);
}

let fileCache = {};
function guessFunctionName(fileName, lineNumber)
{
  if (!(fileName in fileCache))
  {
    try
    {
      let request = new XMLHttpRequest();
      request.open("GET", fileName, false);
      request.overrideMimeType("text/plain");
      request.send(null);
      fileCache[fileName] = request.responseText.split(/\n/);
    }
    catch (e)
    {
      return "anonymous";
    }
  }

  let data = fileCache[fileName];

  lineNumber--;
  if (lineNumber >= 0 && lineNumber < data.length && /(\w+)\s*[:=]\s*function/.test(data[lineNumber]))
    return RegExp.$1;

  lineNumber--;
  if (lineNumber >= 0 && lineNumber < data.length && /(\w+)\s*[:=]\s*function/.test(data[lineNumber]))
    return RegExp.$1;

  return "anonymous";
}

if (/[?&]profiler/i.test(location.href))
{
  let debuggerService = Cc["@mozilla.org/js/jsd/debugger-service;1"].getService(Ci.jsdIDebuggerService);

  let oldFinish = SimpleTest.finish;
  SimpleTest.finish = function()
  {
    showProfilingData(debuggerService);
    debuggerService.off();
    return oldFinish.apply(this, arguments);
  }
  window.addEventListener("unload", function()
  {
    debuggerService.off();
  }, true);
  debuggerService.on();
  debuggerService.flags |= debuggerService.COLLECT_PROFILE_DATA;
  debuggerService.clearProfileData();
}
