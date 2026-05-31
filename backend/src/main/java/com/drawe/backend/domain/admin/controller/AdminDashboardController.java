package com.drawe.backend.domain.admin.controller;

import com.drawe.backend.domain.admin.service.AdminAnalyticsService;
import com.drawe.backend.domain.admin.service.AdminCostService;
import com.drawe.backend.domain.admin.service.AdminFlowService;
import com.drawe.backend.domain.admin.service.AdminFunnelService;
import com.drawe.backend.domain.admin.service.AdminSearchService;
import com.drawe.backend.domain.admin.service.AdminTranslationService;
import com.drawe.backend.domain.admin.service.AdminTagEngagementService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * 어드민 대시보드 (서버 렌더링 Thymeleaf).
 *
 * <p>탭: Overview / 흐름 / Funnel / Search Quality / Translation / Cost. 인증은 {@code AdminSecurityConfig}.
 */
@Controller
@RequestMapping("/admin")
@RequiredArgsConstructor
public class AdminDashboardController {

  private static final int MAX_HOURS = 24 * 90;

  private final AdminAnalyticsService analyticsService;
  private final AdminFunnelService funnelService;
  private final AdminSearchService searchService;
  private final AdminTranslationService translationService;
  private final AdminFlowService flowService;
  private final AdminCostService costService;
  private final AdminTagEngagementService tagEngagementService;
  @GetMapping("/login")
  public String login() {
    return "admin/login";
  }

  @GetMapping({"", "/"})
  public String index() {
    return "redirect:/admin/overview";
  }

  @GetMapping("/overview")
  public String overview(
      @RequestParam(name = "hours", defaultValue = "24") int hours, Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("kpi", analyticsService.buildOverview(safeHours));
    model.addAttribute("hours", safeHours);
    return "admin/overview";
  }

  /** 이용 흐름 — 세션 단계 퍼널 (③). */
  @GetMapping("/flow")
  public String flow(@RequestParam(name = "hours", defaultValue = "168") int hours, Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("view", flowService.build(safeHours));
    model.addAttribute("hours", safeHours);
    return "admin/flow";
  }

  /** Engagement Funnel + 추천 적합도 요약 (②). */
  @GetMapping("/funnel")
  public String funnel(
      @RequestParam(name = "hours", defaultValue = "168") int hours,
      @RequestParam(name = "page",  defaultValue = "1")   int page,
      @RequestParam(name = "size",  defaultValue = "15")  int size,
      @RequestParam(name = "q",     required = false)     String q,
      Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("summary", funnelService.buildSummary(safeHours));
    model.addAttribute("funnel",  funnelService.buildFunnel(safeHours, page, size, q));
    model.addAttribute("hours",   safeHours);
    return "admin/funnel";
  }

  @GetMapping("/search-quality")
  public String searchQuality(
      @RequestParam(name = "hours", defaultValue = "168") int hours,
      @RequestParam(name = "bpage", defaultValue = "1")   int bp,
      @RequestParam(name = "bsize", defaultValue = "30")  int bs,
      @RequestParam(name = "bq",    required = false)     String bq,
      @RequestParam(name = "dpage", defaultValue = "1")   int dp,
      @RequestParam(name = "dsize", defaultValue = "30")  int ds,
      @RequestParam(name = "dq",    required = false)     String dq,
      Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("view", searchService.build(safeHours, bp, bs, bq, dp, ds, dq));
    model.addAttribute("hours", safeHours);
    return "admin/search-quality";
  }

  @GetMapping("/translation")
  public String translation(
      @RequestParam(name = "hours", defaultValue = "168") int hours, Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("view", translationService.build(safeHours));
    model.addAttribute("hours", safeHours);
    return "admin/translation";
  }

  /** 비용·사용량 — 토큰/호출 수·추정 비용·AI 이미지 생성량. */
  @GetMapping("/cost")
  public String cost(@RequestParam(name = "hours", defaultValue = "168") int hours, Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("view", costService.build(safeHours));
    model.addAttribute("hours", safeHours);
    return "admin/cost";
  }

  @GetMapping("/tag-engagement")
  public String tagEngagement(
      @RequestParam(name = "hours", defaultValue = "2160") int hours, Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("view", tagEngagementService.build(safeHours));
    model.addAttribute("hours", safeHours);
    return "admin/tag-engagement";
  }

  private static int clampHours(int hours) {
    return Math.min(Math.max(hours, 1), MAX_HOURS);
  }
}
