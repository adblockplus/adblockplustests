# Adblock Plus Tests

## Introduction

The `adblockplustests` repository contains the test suite for the Adblock Plus
extension in Firefox. This test suite is itself a separate Firefox extension
which interacts with the Adblock Plus extension in order to test it.
(It is therefore assumed that the tests should pass when the latest available
revisions of `adblockplus` and `adblockplustests` are used in combination.)

Some of the tests in this test suite are also reused by the Chrome/Opera/Safari
version of Adblock Plus. Please see the `adblockpluschrome` repository for
details on how to run the tests there.


## Usage

To test your changes to Adblock Plus for Firefox you will need to build and
install both your modified version of the extension and the test suite. For
each project you will need to type the following:

    ./build.py build

This will create a build with a name in the form
`adblockplus[tests]-1.2.3.nnnn.xpi`, which you can then manually add to Firefox.

Alternatively, to speed up the process, you can install the
[Extension Auto-Installer](https://addons.mozilla.org/addon/autoinstaller)
extension. Assuming that Extension Auto-Installer is configured to use port 8888
(the default value), you can build and install in one step by running:

    ./build.py autoinstall 8888

Once both the Adblock Plus and Adblock Plus Tests extensions have been built and
installed you can run the test suite by opening the Firefox Add-ons Manager,
pressing the "Preferences" button for the Adblock Plus Tests extension and then
pressing the "Run" button.

Things to note:

- The test suite can take some time to run, sometimes several minutes.
- If you re-install the Adblock Plus Tests extension you will need to re-load
  the preferences page before pressing "Run" again. Otherwise the tests will not
  re-start.
- Some tests are currently known to fail (sometimes depending on your browser
  version and configuration). It is recommended to run the test suite first,
  before making any changes, to check which tests are expected to fail.
