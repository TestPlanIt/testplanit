"use client";

import { useTranslations } from "next-intl";

export function SearchHelpContent() {
  const t = useTranslations();

  return (
    <div className="space-y-3 text-sm">
      <div>
        <h3 className="font-semibold text-primary">
          {t("search.help.exactPhrases")}
        </h3>
        <p className="text-muted-foreground">
          {t("search.help.exactPhrasesDesc")}
        </p>
        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
          {'"login page"'}
        </code>
      </div>
      <div>
        <h3 className="font-semibold text-primary">
          {t("search.help.booleanOperators")}
        </h3>
        <ul className="text-muted-foreground space-y-1 mt-1">
          <li>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              {"AND"}
            </code>
            {" \u2014 "}
            {t("search.help.andDesc")}
          </li>
          <li>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              {"OR"}
            </code>
            {" \u2014 "}
            {t("search.help.orDesc")}
          </li>
          <li>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              {"NOT"}
            </code>
            {" \u2014 "}
            {t("search.help.notDesc")}
          </li>
          <li>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              {"+"}
            </code>
            {" / "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              {"-"}
            </code>
            {" \u2014 "}
            {t("search.help.prefixDesc")}
          </li>
          <li>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              {"( )"}
            </code>
            {" \u2014 "}
            {t("search.help.groupingDesc")}
          </li>
        </ul>
      </div>
      <div>
        <h3 className="font-semibold text-primary">
          {t("search.help.wildcards")}
        </h3>
        <ul className="text-muted-foreground space-y-1 mt-1">
          <li>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              {"test*"}
            </code>
            {" \u2014 "}
            {t("search.help.wildcardMultiDesc")}
          </li>
          <li>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              {"te?t"}
            </code>
            {" \u2014 "}
            {t("search.help.wildcardSingleDesc")}
          </li>
        </ul>
      </div>
      <div>
        <h3 className="font-semibold text-primary">
          {t("search.help.fuzzyMatching")}
        </h3>
        <p className="text-muted-foreground">
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
            {"logn~"}
          </code>
          {" \u2014 "}
          {t("search.help.fuzzyDesc")}
        </p>
      </div>
      <div>
        <h3 className="font-semibold text-primary">
          {t("search.help.proximity")}
        </h3>
        <p className="text-muted-foreground">
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
            {'"login page"~3'}
          </code>
          {" \u2014 "}
          {t("search.help.proximityDesc")}
        </p>
      </div>
      <div className="text-xs text-muted-foreground border-t pt-2">
        <p>{t("search.help.defaultBehavior")}</p>
        <a
          href="https://www.elastic.co/docs/explore-analyze/query-filter/languages/lucene-query-syntax"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:opacity-80 mt-1 inline-block"
        >
          {t("search.help.fullSyntaxLink")}
        </a>
      </div>
    </div>
  );
}
