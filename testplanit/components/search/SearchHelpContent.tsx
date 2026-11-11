"use client";

import { useTranslations } from "next-intl";

export function SearchHelpContent() {
  const t = useTranslations();

  return (
    <div className="space-y-3 text-sm">
      <div>
        <h3 className="font-semibold text-primary">{t("search.help.ids")}</h3>
        <p className="text-muted-foreground">{t("search.help.idsDesc")}</p>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {"1234 OR 5678"}
        </code>
      </div>
      <div>
        <h3 className="font-semibold text-primary">
          {t("search.help.exactPhrases")}
        </h3>
        <p className="text-muted-foreground">
          {t("search.help.exactPhrasesDesc")}
        </p>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {'"login page"'}
        </code>
      </div>
      <div>
        <h3 className="font-semibold text-primary">
          {t("search.help.booleanOperators")}
        </h3>
        <ul className="mt-1 space-y-1 text-muted-foreground">
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {"AND"}
            </code>
            {" \u2014 "}
            {t("search.help.andDesc")}
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {"OR"}
            </code>
            {" \u2014 "}
            {t("search.help.orDesc")}
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {"NOT"}
            </code>
            {" \u2014 "}
            {t("search.help.notDesc")}
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {"+"}
            </code>
            {" / "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {"-"}
            </code>
            {" \u2014 "}
            {t("search.help.prefixDesc")}
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
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
        <ul className="mt-1 space-y-1 text-muted-foreground">
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {"test*"}
            </code>
            {" \u2014 "}
            {t("search.help.wildcardMultiDesc")}
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
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
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
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
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {'"login page"~3'}
          </code>
          {" \u2014 "}
          {t("search.help.proximityDesc")}
        </p>
      </div>
      <div className="border-t pt-2 text-xs text-muted-foreground">
        <p>{t("search.help.defaultBehavior")}</p>
        <a
          href="https://www.elastic.co/docs/explore-analyze/query-filter/languages/lucene-query-syntax"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-primary underline hover:opacity-80"
        >
          {t("search.help.fullSyntaxLink")}
        </a>
      </div>
    </div>
  );
}
