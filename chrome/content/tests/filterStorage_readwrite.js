(function()
{
  module("Filter storage read/write", {
    setup: function()
    {
      prepareFilterComponents.call(this);
      preparePrefs.call(this);
    },
    teardown: function()
    {
      restoreFilterComponents.call(this);
      restorePrefs.call(this);
    }
  });

  let {FileUtils} = Cu.import("resource://gre/modules/FileUtils.jsm", null);
  let {NetUtil} = Cu.import("resource://gre/modules/NetUtil.jsm", null);

  let filtersData = (function()
  {
    let lines = ["# Adblock Plus preferences", "version=4"];
    for (let i = 0; i < 40000; i++)
    {
      lines.push("[Filter]", `text=foobar${i}`, `hitCount=${i+10}`,
                 `lastHit=${i+1400000000000}`);
    }

    lines.push("[Subscription]", "url=http://foo.example.com/",
               "title=Test subscription");
    lines.push("[Subscription filters]");
    for (let i = 0; i < 40000; i++)
      lines.push(`foobar${i}`);
    return lines.join("\n") + "\n";
  })();

  function writeToFile(file, data)
  {
    let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                      .createInstance(Ci.nsIScriptableUnicodeConverter);
    converter.charset = "utf-8";
    data = converter.ConvertFromUnicode(data);

    let stream = FileUtils.openFileOutputStream(file);
    stream.write(data, data.length);
    stream.close();
  }

  function readFromFile(file)
  {
    return new Promise((resolve, reject) =>
    {
      let stream = Cc["@mozilla.org/network/file-input-stream;1"]
                     .createInstance(Ci.nsIFileInputStream);
      stream.init(file, FileUtils.MODE_RDONLY, FileUtils.PERMS_FILE,
                  Ci.nsIFileInputStream.DEFER_OPEN);

      NetUtil.asyncFetch(stream, (inputStream, nsresult) =>
      {
        resolve(NetUtil.readInputStreamToString(inputStream,
            inputStream.available(), {charset: "utf-8"}));
      });
    });
  }

  function canonicalizeFiltersData(data)
  {
    let curSection = null;
    let sections = [];
    for (let line of (data + "\n[end]").split(/[\r\n]+/))
    {
      if (/^\[.*\]$/.test(line))
      {
        if (curSection)
          sections.push(curSection);

        curSection = {header: line, data: []};
      }
      else if (curSection && /\S/.test(line))
        curSection.data.push(line);
    }
    for (let section of sections)
    {
      section.key = section.header + " " + section.data[0];
      section.data.sort();
    }
    sections.sort((a, b) =>
    {
      if (a.key < b.key)
        return -1;
      else if (a.key > b.key)
        return 1;
      else
        return 0;
    });
    return sections.map(section =>
    {
      return [section.header].concat(section.data).join("\n");
    }).join("\n");
  }

  function testReadWrite()
  {
    let tempFile = FileUtils.getFile("TmpD", ["temp_patterns.ini"]);
    tempFile.createUnique(tempFile.NORMAL_FILE_TYPE, FileUtils.PERMS_FILE);
    writeToFile(tempFile, filtersData);

    Promise.resolve().then(() =>
    {
      FilterStorage.loadFromDisk(tempFile);
      return FilterNotifier.once("load");
    }).then(() =>
    {
      tempFile.remove(false);
      FilterStorage.saveToDisk(tempFile);
      return FilterNotifier.once("save");
    }).then(() =>
    {
      return readFromFile(tempFile);
    }).then(fileData =>
    {
      tempFile.remove(false);

      equal(canonicalizeFiltersData(fileData),
            canonicalizeFiltersData(filtersData),
            "Read/write result");
      start();
    }).catch(error =>
    {
      Cu.reportError(error);
      ok(false, "Caught error: " + error);
      start();
    });
  }

  asyncTest("Read and save to file", testReadWrite);
  asyncTest("Read and save with please_kill_startup_performance set", () =>
  {
    Prefs.please_kill_startup_performance = true;
    testReadWrite();
  });
})();
