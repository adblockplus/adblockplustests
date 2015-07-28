(function()
{
  let {application} = require("info");
  if (application != "firefox")
    return;

  let CustomizableUI =  null;
  let usingShim = false;
  try
  {
    ({CustomizableUI} = Cu.import("resource:///modules/CustomizableUI.jsm", null));
  }
  catch (e)
  {
    usingShim = true;
    // No built-in CustomizableUI API, use our own implementation.
    ({CustomizableUI} = require("customizableUI"));
  }

  let wnd = UI.currentWindow;
  let defaultParent = require("appSupport").defaultToolbarPosition.parent;

  let toolbox;
  if (usingShim)
  {
    let toolbar = wnd.document.getElementById(defaultParent);
    if (!toolbar)
      return;
    toolbox = toolbar.toolbox;
  }

  module("Icon position", {
    setup: function()
    {
      // Force default position
      if (usingShim)
        toolbox.removeAttribute("abp-iconposition");

      if (UI.isToolbarIconVisible(wnd))
        UI.toggleToolbarIcon();
    },
    teardown: function()
    {
      UI.toggleToolbarIcon();
      UI.toggleToolbarIcon();
    }
  });

  test("Put icon at default position", function()
  {
    UI.toggleToolbarIcon();
    let placement = CustomizableUI.getPlacementOfWidget("abp-toolbarbutton");
    ok(placement, "Button is visible");
    if (placement)
      equal(placement.area, defaultParent, "Button is at the right position");

    UI.toggleToolbarIcon();
    placement = CustomizableUI.getPlacementOfWidget("abp-toolbarbutton");
    ok(!placement, "Button is invisible");

    UI.toggleToolbarIcon();
    placement = CustomizableUI.getPlacementOfWidget("abp-toolbarbutton");
    ok(placement, "Button is visible");
    if (placement)
      equal(placement.area, defaultParent, "Button is at the right position again");
  });

  test("Move icon into tabs bar and restore", function()
  {
    // The shim doesn't have proper support for addToWidgetArea
    if (usingShim) {
      ok(true, "Can't test");
      return;
    }

    UI.toggleToolbarIcon();

    CustomizableUI.addWidgetToArea("abp-toolbarbutton", CustomizableUI.AREA_TABSTRIP);
    let placement = CustomizableUI.getPlacementOfWidget("abp-toolbarbutton");
    ok(placement, "Button is visible");
    if (placement)
      equal(placement.area, CustomizableUI.AREA_TABSTRIP, "Button is in tabstrip");

    UI.toggleToolbarIcon();
    placement = CustomizableUI.getPlacementOfWidget("abp-toolbarbutton");
    ok(!placement, "Button is invisible");

    UI.toggleToolbarIcon();
    placement = CustomizableUI.getPlacementOfWidget("abp-toolbarbutton");
    ok(placement, "Button is visible");
    if (placement)
      equal(placement.area, CustomizableUI.AREA_NAVBAR, "Button is at default position");
  });

})();
