(function()
{
  module("CSS property filter", {
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

  function runSelectorTest([text, domain, filters, expected])
  {
    for (let filter of filters)
    {
      filter = Filter.fromText(filter);
      if (filter instanceof CSSPropertyFilter)
        CSSRules.add(filter);
      else
        ElemHide.add(filter);
    }

    let result = CSSRules.getRulesForDomain(domain)
        .map((filter) => filter.text);
    deepEqual(result.sort(), expected.sort(), text);

    CSSRules.clear();
    ElemHide.clear();
  }

  let selectorTests = [
    ["Ignore generic filters", "example.com", ["##[-abp-properties='foo']", "example.com##[-abp-properties='foo']", "~example.com##[-abp-properties='foo']"], ["example.com##[-abp-properties='foo']"]],
    ["Ignore selectors with exceptions", "example.com", ["example.com##[-abp-properties='foo']", "example.com##[-abp-properties='bar']", "example.com#@#[-abp-properties='foo']"], ["example.com##[-abp-properties='bar']"]],
    ["Ignore filters that include parent domain but exclude subdomain", "www.example.com", ["~www.example.com,example.com##[-abp-properties='foo']"], []],
    ["Ignore filters with parent domain if exception matches subdomain", "www.example.com", ["www.example.com#@#[-abp-properties='foo']", "example.com##[-abp-properties='foo']"], []],
    ["Ignore filters for other subdomain", "other.example.com", ["www.example.com##[-abp-properties='foo']", "other.example.com##[-abp-properties='foo']"], ["other.example.com##[-abp-properties='foo']"]]
  ];

  test("Domain restrictions", function()
  {
    selectorTests.forEach(runSelectorTest);
  });

  function compareRules(text, domain, expected)
  {
    let result = CSSRules.getRulesForDomain(domain)
        .map((filter) => filter.text);
    expected = expected.map((filter) => filter.text);
    deepEqual(result.sort(), expected.sort(), text);
  }

  test("CSS property filters container", function()
  {
    let domainFilter = Filter.fromText("example.com##filter1");
    let subdomainFilter = Filter.fromText("www.example.com##filter2");
    let otherDomainFilter = Filter.fromText("other.example.com##filter3");

    CSSRules.add(domainFilter);
    CSSRules.add(subdomainFilter);
    CSSRules.add(otherDomainFilter);
    compareRules("Return all matching filters", "www.example.com",
        [domainFilter, subdomainFilter]);

    CSSRules.remove(domainFilter);
    compareRules("Return all matching filters after removing one",
        "www.example.com", [subdomainFilter]);

    CSSRules.clear();
    compareRules("Return no filters after clearing", "www.example.com", []);
  });
})();
