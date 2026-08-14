<?xml version="1.0" encoding="UTF-8"?>
<!--
  Browser-facing stylesheet for the sitemaps.

  This is presentation ONLY. Crawlers ignore <?xml-stylesheet?> entirely; it is read
  by browsers, which otherwise render a sitemap as a collapsed tree under a grey
  "This XML file does not appear to have any style information" banner. Nothing here
  changes a single byte of what a crawler parses.

  XSLT 1.0 on purpose: it is the only version browsers implement. Do not reach for
  2.0/3.0 constructs (xsl:function, sequences, regex) - they fail silently in the
  browser and you get the raw tree back with no error.

  One stylesheet serves both document types. The two templates below match on the
  sitemap namespace, so whichever root element is present is the one that renders.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">

  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <!-- A sitemap is for crawlers; this rendering is for people, and it should
             never itself compete for a query. -->
        <meta name="robots" content="noindex"/>
        <title>Sitemap · Provenance</title>
        <style>
          :root {
            --bg: #f7f9fa;
            --panel: #ffffff;
            --ink: #1f2a37;
            --muted: #54606d;
            --faint: #7d8d97;
            --rule: rgba(15, 23, 42, 0.10);
            --accent: #0e7d97;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #0d151d;
              --panel: #14202b;
              --ink: #dce5ea;
              --muted: #93a4b0;
              --faint: #6f818d;
              --rule: rgba(255, 255, 255, 0.10);
              --accent: #4bb8d4;
            }
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--bg);
            color: var(--ink);
            font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          .wrap { max-width: 1080px; margin: 0 auto; padding: 40px 20px 80px; }
          h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: -0.01em; }
          .lede { color: var(--muted); margin: 0 0 4px; max-width: 68ch; }
          .count {
            font-variant-numeric: tabular-nums;
            color: var(--faint);
            font-size: 13px;
            margin: 14px 0 22px;
          }
          .panel {
            background: var(--panel);
            border: 1px solid var(--rule);
            border-radius: 10px;
            overflow: hidden;
          }
          .scroll { overflow-x: auto; }
          table { width: 100%; border-collapse: collapse; }
          th {
            text-align: left;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--faint);
            font-weight: 600;
            padding: 12px 16px;
            border-bottom: 1px solid var(--rule);
            white-space: nowrap;
          }
          td {
            padding: 10px 16px;
            border-bottom: 1px solid var(--rule);
            vertical-align: top;
            font-variant-numeric: tabular-nums;
          }
          tr:last-child td { border-bottom: none; }
          td.n { color: var(--faint); font-size: 13px; width: 1%; white-space: nowrap; }
          td.meta { color: var(--muted); font-size: 13px; white-space: nowrap; }
          a { color: var(--accent); text-decoration: none; word-break: break-all; }
          a:hover { text-decoration: underline; }
          a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
          .note {
            margin-top: 22px;
            color: var(--faint);
            font-size: 13px;
            max-width: 68ch;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <xsl:apply-templates/>
        </div>
      </body>
    </html>
  </xsl:template>

  <!-- The index: a list of child sitemaps. -->
  <xsl:template match="sm:sitemapindex">
    <h1>Sitemap index</h1>
    <p class="lede">
      This file lists the sitemaps for provenance-online.vercel.app. It is split so
      each group's indexing can be measured separately rather than as one aggregate.
    </p>
    <p class="count"><xsl:value-of select="count(sm:sitemap)"/> sitemaps</p>
    <div class="panel">
      <div class="scroll">
        <table>
          <tr>
            <th>#</th>
            <th>Sitemap</th>
            <th>Last modified</th>
          </tr>
          <xsl:for-each select="sm:sitemap">
            <tr>
              <td class="n"><xsl:value-of select="position()"/></td>
              <td>
                <a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a>
              </td>
              <td class="meta">
                <xsl:choose>
                  <xsl:when test="sm:lastmod"><xsl:value-of select="substring(sm:lastmod, 1, 10)"/></xsl:when>
                  <xsl:otherwise>—</xsl:otherwise>
                </xsl:choose>
              </td>
            </tr>
          </xsl:for-each>
        </table>
      </div>
    </div>
    <p class="note">
      Styling is for humans only. Search engines ignore it and read the underlying
      XML, which is unchanged.
    </p>
  </xsl:template>

  <!-- A child sitemap: the URLs themselves. -->
  <xsl:template match="sm:urlset">
    <h1>Sitemap</h1>
    <p class="lede">
      Pages in this section of provenance-online.vercel.app, with how often each is
      expected to change.
    </p>
    <p class="count"><xsl:value-of select="count(sm:url)"/> URLs</p>
    <div class="panel">
      <div class="scroll">
        <table>
          <tr>
            <th>#</th>
            <th>URL</th>
            <th>Changes</th>
            <th>Priority</th>
            <th>Last modified</th>
          </tr>
          <xsl:for-each select="sm:url">
            <tr>
              <td class="n"><xsl:value-of select="position()"/></td>
              <td>
                <a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a>
              </td>
              <td class="meta">
                <xsl:choose>
                  <xsl:when test="sm:changefreq"><xsl:value-of select="sm:changefreq"/></xsl:when>
                  <xsl:otherwise>—</xsl:otherwise>
                </xsl:choose>
              </td>
              <td class="meta">
                <xsl:choose>
                  <xsl:when test="sm:priority"><xsl:value-of select="sm:priority"/></xsl:when>
                  <xsl:otherwise>—</xsl:otherwise>
                </xsl:choose>
              </td>
              <td class="meta">
                <xsl:choose>
                  <xsl:when test="sm:lastmod"><xsl:value-of select="substring(sm:lastmod, 1, 10)"/></xsl:when>
                  <xsl:otherwise>—</xsl:otherwise>
                </xsl:choose>
              </td>
            </tr>
          </xsl:for-each>
        </table>
      </div>
    </div>
    <p class="note">
      Styling is for humans only. Search engines ignore it and read the underlying
      XML, which is unchanged.
    </p>
  </xsl:template>

</xsl:stylesheet>
