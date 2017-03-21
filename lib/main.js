/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2017 eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

let {XPCOMUtils} = Cu.import("resource://gre/modules/XPCOMUtils.jsm", null);
let {Services} = Cu.import("resource://gre/modules/Services.jsm", null);

let optionsObserver =
{
  init: function()
  {
    Services.obs.addObserver(this, "addon-options-displayed", true);
    onShutdown.add(function()
    {
      Services.obs.removeObserver(this, "addon-options-displayed");
    }.bind(this));
  },

  observe: function(subject, topic, data)
  {
    let {addonID} = require("info")
    if (data != addonID)
      return;

    let doc = subject.QueryInterface(Ci.nsIDOMDocument);

    let testList = doc.getElementById("adblockplustests-tests");
    for (let test of getTests())
      testList.appendItem(test, test);

    doc.getElementById("adblockplustests-run").addEventListener("command", doRun, false);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
};
optionsObserver.init();

function doRun(event)
{
  let wnd = Services.wm.getMostRecentWindow("adblockplustests:harness");
  if (wnd)
  {
    wnd.focus();
    return;
  }

  let doc = event.target.ownerDocument;

  let params = "";
  let testList = doc.getElementById("adblockplustests-tests");
  if (testList.value)
    params = "?test=" + encodeURIComponent(testList.value);

  doc.defaultView.openDialog("chrome://adblockplustests/content/harness.xul" + params, "_blank", "chrome,centerscreen,resizable,dialog=no");
}

function getTests()
{
  let result = [];

  let {addonRoot} = require("info");
  let uri = Services.io.newURI(addonRoot, null, null).QueryInterface(Components.interfaces.nsIJARURI);
  let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
  zipReader.open(uri.JARFile.QueryInterface(Ci.nsIFileURL).file);

  try
  {
    let enumerator = zipReader.findEntries(null);
    let prefix = "chrome/content/tests/";
    let suffix = ".js";
    while (enumerator.hasMore())
    {
      let name = enumerator.getNext();
      if (name.indexOf(prefix) == 0 && name.lastIndexOf(suffix) == name.length - suffix.length)
        result.push(name.substring(prefix.length, name.length - suffix.length));
    }
  }
  finally
  {
    zipReader.close();
  }
  result.sort();
  return result;
};
exports.getTests = getTests;
