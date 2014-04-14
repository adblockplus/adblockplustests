(function()
{
  module("I/O");

  let {FileUtils} = Cu.import("resource://gre/modules/FileUtils.jsm", null);
  let file = FileUtils.getFile("TmpD", ["adblockplustests-test1.txt"]);
  let fileRenamed = FileUtils.getFile("TmpD", ["adblockplustests-test2.txt"])
  let currentTest = -1;

  let tests = [
    write.bind(null, file),
    checkExists.bind(null, file),
    read.bind(null, file),
    rename.bind(null, file, fileRenamed),
    checkExists.bind(null, fileRenamed),
    checkMissing.bind(null, file),
    read.bind(null, fileRenamed),
    copy.bind(null, fileRenamed, file),
    checkExists.bind(null, fileRenamed),
    checkExists.bind(null, file),
    read.bind(null, file),
    remove.bind(null, fileRenamed),
    checkMissing.bind(null, fileRenamed),
    checkExists.bind(null, file),
    remove.bind(null, file),
    checkMissing.bind(null, fileRenamed),
    checkMissing.bind(null, file),
    failedRead.bind(null, file)
  ];

  function runNextTest()
  {
    currentTest++;
    if (currentTest < tests.length)
      tests[currentTest]();
    else
      start();
  }

  function write(file)
  {
    IO.writeToFile(file, function dataGenerator()
    {
      for (let i = 0; i < 10000; i++)
        yield "\u1234" + i + "\uffff\x00";
    }(), function writeCallback(e)
    {
      equal(e && e.toString(), null, "Write succeeded");
      runNextTest();
    }, null);
  }

  function read(file)
  {
    let eofReceived = false;
    let i = 0;
    IO.readFromFile(file, {
      process: function(line)
      {
        if (eofReceived)
          ok(false, "No lines received after EOF");

        if (line === null)
        {
          eofReceived = true;
          equal(i, 10000, "10000 lines received before EOF");
        }
        else
        {
          let expected = "\u1234" + i + "\uffff\x00";
          if (line != expected)
            equal(line, expected, "Line " + i + " contents");
          i++;
        }
      }
    }, function readCallback(e)
    {
      equal(e && e.toString(), null, "Read succeeded");
      ok(eofReceived, "File processor received EOF indicator before callback was called");
      runNextTest();
    }, null);
  }

  function failedRead(file)
  {
    IO.readFromFile(file, {
      process: function(line)
      {
        ok(false, "Line received for non-existing file")
      }
    }, function readCallback(e)
    {
      ok(e, "Error received reading non-existing file");
      runNextTest();
    });
  }

  function copy(from, to)
  {
    IO.copyFile(from, to, function copyCallback(e)
    {
      equal(e && e.toString(), null, "Copy succeeded");
      runNextTest();
    });
  }

  function rename(from, to)
  {
    IO.renameFile(from, to.leafName, function renameCallback(e)
    {
      equal(e && e.toString(), null, "Rename succeeded");
      runNextTest();
    });
  }

  function remove(file)
  {
    IO.removeFile(file, function removeCallback(e)
    {
      equal(e && e.toString(), null, "Remove succeeded");
      runNextTest();
    });
  }

  function checkExists(file)
  {
    IO.statFile(file, function statCallback(e, info)
    {
      equal(e && e.toString(), null, "Stat succeeded");
      if (!e)
      {
        ok(info.exists, "File exists");
        ok(!info.isDirectory, "File is not a directory");
        ok(info.isFile, "File is a regular file");
        ok(Date.now() - info.lastModified < 5000, "File modification time is recent");
      }
      runNextTest();
    });
  }

  function checkMissing(file)
  {
    IO.statFile(file, function statCallback(e, info)
    {
      equal(e && e.toString(), null, "Stat succeeded");
      if (!e)
      {
        ok(!info.exists, "File does not exist");
      }
      runNextTest();
    });
  }

  asyncTest("File operations", function()
  {
    runNextTest();
  });
})();
