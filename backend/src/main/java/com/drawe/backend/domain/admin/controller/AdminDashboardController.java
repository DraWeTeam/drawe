package com.drawe.backend.domain.admin.controller;

import com.drawe.backend.domain.admin.service.AdminAnalyticsService;
import com.drawe.backend.domain.admin.service.AdminCostService;
import com.drawe.backend.domain.admin.service.AdminFlowService;
import com.drawe.backend.domain.admin.service.AdminFunnelService;
import com.drawe.backend.domain.admin.service.AdminSearchService;
import com.drawe.backend.domain.admin.service.AdminTagEngagementService;
import com.drawe.backend.domain.admin.service.ChipService;
import com.drawe.backend.domain.admin.service.GuideAdminService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * 어드민 대시보드 (서버 렌더링 Thymeleaf).
 *
 * <p>탭: Overview / 흐름 / Funnel / Search Quality / Translation / Cost. 인증은 {@code
 * AdminSecurityConfig}.
 */
@Controller
@RequestMapping("/admin")
@RequiredArgsConstructor
public class AdminDashboardController {

  private static final int MAX_HOURS = 24 * 90;

  private final AdminAnalyticsService analyticsService;
  private final AdminFunnelService funnelService;
  private final AdminSearchService searchService;
  private final AdminFlowService flowService;
  private final AdminCostService costService;
  private final AdminTagEngagementService tagEngagementService;
  private final ChipService chipService;
  private final GuideAdminService guideAdminService;

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

  /**
   * Engagement Funnel — 능동 수집(active curation) 관점: 사용자가 직접 끌어온 이미지(생성/검색)의 노출→좋아요→저장.
   *
   * <p>{@code source}: {@code generated}(생성 AI, 기본) / {@code board}(무드 보드 검색, Phase 2 로깅 대기) /
   * {@code guiding}(채팅 추천 ref, 레거시 비교용).
   */
  @GetMapping("/funnel")
  public String funnel(
      @RequestParam(name = "hours", defaultValue = "168") int hours,
      @RequestParam(name = "page", defaultValue = "1") int page,
      @RequestParam(name = "size", defaultValue = "15") int size,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(name = "source", defaultValue = "generated") String source,
      Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("summary", funnelService.buildSummary(safeHours, source));
    model.addAttribute("funnel", funnelService.buildFunnel(safeHours, page, size, q, source));
    model.addAttribute("hours", safeHours);
    model.addAttribute("source", source);
    return "admin/funnel";
  }

  @GetMapping("/search-quality")
  public String searchQuality(
      @RequestParam(name = "hours", defaultValue = "168") int hours,
      @RequestParam(name = "bpage", defaultValue = "1") int bp,
      @RequestParam(name = "bsize", defaultValue = "30") int bs,
      @RequestParam(name = "bq", required = false) String bq,
      @RequestParam(name = "dpage", defaultValue = "1") int dp,
      @RequestParam(name = "dsize", defaultValue = "30") int ds,
      @RequestParam(name = "dq", required = false) String dq,
      @RequestParam(name = "bbpage", defaultValue = "1") int bbp,
      @RequestParam(name = "bbsize", defaultValue = "30") int bbs,
      @RequestParam(name = "bbq", required = false) String bbq,
      @RequestParam(name = "bdpage", defaultValue = "1") int bdp,
      @RequestParam(name = "bdsize", defaultValue = "30") int bds,
      @RequestParam(name = "bdq", required = false) String bdq,
      Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute(
        "view",
        searchService.build(safeHours, bp, bs, bq, dp, ds, dq, bbp, bbs, bbq, bdp, bds, bdq));
    model.addAttribute("hours", safeHours);
    return "admin/search-quality";
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

  /** 칩 분석 — AI 추천 키워드 칩의 노출→반영 전환율(추천 품질). */
  @GetMapping("/chip")
  public String chip(@RequestParam(name = "hours", defaultValue = "2160") int hours, Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("view", chipService.build(safeHours));
    model.addAttribute("hours", safeHours);
    return "admin/chip";
  }

  /** 가이딩 — 이미지 기반 한 끗 가이드의 품질(만족도·품질 저하·축 분포·생성 추이). */
  @GetMapping("/guide")
  public String guide(@RequestParam(name = "hours", defaultValue = "720") int hours, Model model) {
    int safeHours = clampHours(hours);
    model.addAttribute("view", guideAdminService.build(safeHours));
    model.addAttribute("hours", safeHours);
    return "admin/guide";
  }

  private static int clampHours(int hours) {
    return Math.min(Math.max(hours, 1), MAX_HOURS);
  }
}
