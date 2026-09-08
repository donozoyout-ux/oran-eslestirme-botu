import { describe, expect, it } from "vitest";
import { dashboardHtml } from "../src/dashboard.js";
import { dashboardClient } from "../src/ui/dashboard-client.js";
import { dashboardShell } from "../src/ui/dashboard-components.js";
import { dashboardStyles } from "../src/ui/dashboard-styles.js";

describe("production dashboard UI", () => {
  it("tüm ana navigasyon etiketlerini sunar", () => {
    for (const label of [
      "Genel Bakış",
      "Bugünün Maçları",
      "Maç Analizi",
      "Historical",
      "Market",
      "Sistem",
      "Ayarlar",
    ]) expect(dashboardHtml).toContain(label);
  });

  it("mevcut read-only durum endpointlerini kullanır", () => {
    expect(dashboardClient).toContain("fetch('/status'");
    expect(dashboardClient).toContain("fetch('/historical-pattern'");
    expect(dashboardClient).toContain("fetch('/match-intelligence'");
    expect(dashboardShell).toContain('href="/daily-matches.csv"');
    expect(dashboardShell).toContain('href="/odds-history.csv"');
  });

  it("intelligence eksik değerlerini sıfır olarak sunmaz", () => {
    expect(dashboardClient).toContain("const UNAVAILABLE = 'Veri mevcut değil'");
    expect(dashboardClient).toContain("feature.availability === 'unavailable'");
    expect(dashboardClient).not.toContain("Number(value || 0)");
  });

  it("yetersiz historical örneklemi açıkça belirtir", () => {
    expect(dashboardClient).toContain("Yeterli tarihsel örnek yok");
    expect(dashboardClient).toContain("analysis.status!=='ok'");
  });

  it("provider error durumunu diagnostic kartlarında işler", () => {
    expect(dashboardClient).toContain("info.lastError||info.error");
    expect(dashboardClient).toContain("bad?'Hata':hasData?'Operasyonel'");
    expect(dashboardShell).toContain('id="systemDiagnostics"');
  });

  it("dinamik provider metnini HTML olarak enjekte etmez", () => {
    expect(dashboardClient).toContain("node.textContent=String(value)");
    expect(dashboardClient).not.toContain("innerHTML");
    expect(dashboardClient).not.toContain("insertAdjacentHTML");
    expect(dashboardClient).not.toContain("eval(");
  });

  it("mobil viewport ve drawer davranışını içerir", () => {
    expect(dashboardHtml).toContain('name="viewport"');
    expect(dashboardStyles).toContain("@media(max-width:820px)");
    expect(dashboardStyles).toContain(".drawer{width:100vw}");
    expect(dashboardShell).toContain('aria-controls="sidebar"');
  });

  it("hassas config alanlarını dashboarda koymaz", () => {
    for (const secretName of [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
      "SPORTMONKS_API_TOKEN",
      "THE_ODDS_API_KEY",
      "DATABASE_URL",
    ]) expect(dashboardHtml).not.toContain(secretName);
    expect(dashboardClient).toContain("safeDiagnosticKeys");
  });

  it("maç detay drawerı ve gerekli sekmeleri sunar", () => {
    expect(dashboardShell).toContain('id="matchDrawer"');
    for (const tab of ["Özet", "Form", "Venue", "Timing", "Stats", "Intelligence"])
      expect(dashboardShell).toContain(`>${tab}</button>`);
    expect(dashboardClient).toContain("openDrawer(fixture)");
    expect(dashboardClient).toContain("Strength normalization");
  });

  it("network hatasında son veriyi korur ve stale uyarısı gösterir", () => {
    expect(dashboardClient).toContain("son başarılı görünüm korunuyor");
    expect(dashboardClient).toContain("STALE_AFTER_MS");
    expect(dashboardShell).toContain("Veri güncel değil");
    expect(dashboardClient).not.toContain("state.data=null");
  });
});
