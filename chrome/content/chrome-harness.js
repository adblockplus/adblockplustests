/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");

function require(module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "adblockplustests-require", module);
  return result.exports;
}

function getMochitestJarListing()
{
  let {addonRoot} = require("info");
  let uri = Services.io.newURI(addonRoot, null, null).QueryInterface(Components.interfaces.nsIJARURI);

  var zReader = Components.classes["@mozilla.org/libjar/zip-reader;1"].
                  createInstance(Components.interfaces.nsIZipReader);
  zReader.open(uri.JARFile.QueryInterface(Components.interfaces.nsIFileURL).file);

  return zList("chrome/content/tests", zReader, "chrome/content/", true);
}

/*
 * Replicate the server.js list() function with a .jar file
 *
 * base: string value of base directory we are testing
 * zReader: handle to opened nsIZipReader object
 * recurse: true|false if we do subdirs
 *
 * returns:
 *  [json object of {dir:{subdir:{file:true, file:true, ...}}}, count of tests]
 */
function zList(base, zReader, baseName, recurse) {
  var dirs = zReader.findEntries(base + "*");
  var links = {};
  var fileArray = [];
  
  while(dirs.hasMore()) {
    var entryName = dirs.getNext();
    if (entryName.substr(-1) == '/' && entryName.split('/').length == (base.split('/').length + 1) ||
        (entryName.substr(-1) != '/' && entryName.split('/').length == (base.split('/').length))) { 
      fileArray.push(entryName);
    }
  }
  fileArray.sort();
  for (var i=0; i < fileArray.length; i++) {
    var myFile = fileArray[i];
    var listName = myFile.replace(baseName, "");
    if (myFile.substr(-1) === '/' && recurse) {
      links[listName] = zList(myFile, zReader, baseName, recurse);
    } else {
      if (myFile.indexOf("SimpleTest") == -1) {
        //we add the '/' so we don't try to run content/content/chrome
        links[listName] = true;
      }
    }
  }
  return links;
}

function getTestList()
{
  return [getMochitestJarListing(), null];
}
