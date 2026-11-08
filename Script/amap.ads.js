/**
 * AMap Enhance — http-response script for Surge.
 * Trims known promo fields only, and fails open on anything unexpected.
 * See SECURITY.md for the data-flow guarantees.
 */

(function () {
  'use strict';

  /** 本仓库所涉接口全部位于这些主机（模块 pattern 已限定，此处二次校验）。 */
  var ALLOWED_HOST_SUFFIX = '.amap.com';

  /** 开屏广告：把素材推到 2090 年，让客户端判定为「已过期」。 */
  var FAR_FUTURE = Math.floor(Date.UTC(2090, 11, 31) / 1000);

  function parseUrl(raw) {
    var m = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(raw || '');
    if (!m) return null;
    return { host: m[1].toLowerCase(), path: m[2] || '/' };
  }

  function own(o, k) {
    return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  }

  function each(list, fn) {
    for (var i = 0; i < list.length; i += 1) fn(list[i]);
  }

  /** 删除 obj 上名为 key 的字段（obj 可能不存在）。 */
  function drop(obj, key) {
    if (own(obj, key)) delete obj[key];
  }

  /** 清空数组字段，保留数组类型；非数组则不动。 */
  function clearArray(container, key) {
    if (own(container, key) && Array.isArray(container[key])) container[key] = [];
  }

  /** 把对象字段置空对象，非对象则不动。 */
  function clearObject(container, key) {
    if (own(container, key) && container[key] && typeof container[key] === 'object') container[key] = {};
  }

  function isAdDynamicId(item) {
    return !!item && typeof item.dynamic_id_s === 'string' && /ads-\d+/.test(item.dynamic_id_s);
  }

  /** POI 详情页里需要整块移除的模块名（推广、带货、房产、票务引流等）。 */
  var POI_DETAIL_MODULES = [
    'CouponBanner', 'CouponPush', 'adStoreBigBannerModule', 'adv_compliance_info', 'adv_gift',
    'bigListBizRec', 'bottomDescription', 'brand_service', 'brand_shop_bar', 'businessQualifications',
    'carServiceCard', 'checkIn', 'check_in', 'cityCardFeed', 'city_discount', 'claim', 'co_branded_card',
    'collector_guide', 'commonAiAgent', 'commonGoodsShelf', 'common_coupon_bar', 'common_coupon_card',
    'comprehensiveEditEntrance', 'contributor', 'cpt_service_shop', 'dayTripList', 'discount_commodity',
    'divergentRecommendModule', 'enhanceCustomerServiceFixedBottom', 'enhanceCustomerServicePoiModule',
    'everyOneToSee', 'feedback', 'first_surround_estate_tab', 'footer_tel_button', 'horizontalGoodsShelf',
    'hospital_strategy', 'hotPlay', 'hot_new_house_estate', 'hot_shop', 'hotelCoupon', 'hotelList',
    'hotelMustRead', 'houseAgentService', 'houseList', 'houseOfficeBrandIntroduction', 'houseOfficeInfo',
    'houseOfficeNotice', 'houseOfficeService', 'houseShelf', 'house_apart_info', 'house_buying_agent',
    'house_coupon', 'house_cp_clues', 'house_cpt_coupon', 'house_cpt_grab', 'house_price', 'house_price_v2',
    'house_rent_sale_agency', 'image_banner', 'kaMarketingCampaign', 'kaProductMixServiceShelf',
    'ka_not_enter', 'legSameIndustryRecEntrance', 'legal_document', 'listBizRec_1', 'listBizRec_2',
    'matrix_banner', 'merchantSettlement', 'membership', 'mini_hook_shelf', 'movie_info',
    'multi_page_anchor', 'nearbyGoodCar', 'nearbyRecommendModule', 'nearby_house',
    'nearby_new_house_estate', 'nearby_office_estate', 'nearby_old_sell_estate', 'nearby_play_rec',
    'newGuest', 'newRelatedRecommends', 'new_operation_banner', 'newsellhouse', 'officerenthouse',
    'officesellhouse', 'official_account', 'official_account_hospital', 'oldsellhouse', 'operation_banner',
    'operator_card', 'packageShelf', 'parentBizRec', 'parentPoiRecEntrance',
    'platformCustomerCommonModule', 'platformCustomerComplianceInfo', 'poiDetailBottomBar',
    'poiDetailBottomBarOperation', 'poiDetailCommonConfig', 'poiDetailNewBeltV2', 'poiDetailWaterFeed',
    'poiDetailWaterFeedTitle', 'poster_banner', 'portal_entrance', 'quickLink', 'relatedRecommends',
    'renthouse', 'rentSaleHouse', 'rentsaleagencyv2', 'rentsaleagencyv3', 'rentsalehouse',
    'residentialOwners', 'retainInfo', 'reviews', 'sameIndustryRecommendModule',
    'sameIndustry2RecommendModule', 'scenic_coupon', 'scenic_filter', 'scenic_lifeservices',
    'scenic_mustplay', 'scenic_play_guide', 'scenic_recommend', 'scenic_voice', 'searchPlaMap',
    'second_surround_estate_tab', 'service_shop', 'shopBaseCase', 'shopStructGift', 'shoppingMallEvent',
    'similarShelfRecommend', 'similarShopRecommend', 'smallListBizRec', 'smallOrListBizRec',
    'societyPublicExperience', 'subscription', 'surroundHouseTab', 'surroundOldSellHouse',
    'surroundRentHouse', 'surround_facility', 'surround_facility_new', 'surround_house_tab',
    'surround_oldsellhouse', 'surround_renthouse', 'surround_rentoffice', 'surround_selloffice',
    'thirdparty_info', 'travelGuideRec', 'uploadBar', 'upload_bar', 'verification', 'waistRecEntrance',
    'waterFallFeed', 'waterFallFeedTitle', 'yellowPageAdRecommendModule'
  ];

  /** 首页整体图层的推广开关，命中后置空 value 让客户端不再渲染。 */
  var LAYER_SWITCHES = [
    'Naviendpage_Searchwords', 'SplashScreenControl', 'TipsTaxiButton', 'amapCoin', 'favorites_info',
    'feedback_banner', 'footprint', 'his_input_tip', 'home_business_position_config', 'hotel_activity',
    'hotel_fillin_opt', 'hotel_loop', 'hotel_tipsicon', 'hotsaleConfig', 'landing_page_info',
    'map_weather_switch', 'maplayers', 'navi_end', 'nearby_business_popup', 'nearby_map_entry_guide',
    'nearby_map_pull_down_guide', 'operation_layer', 'poi_rec', 'preword', 'route_banner',
    'routeresult_banner', 'search_homepage', 'search_keyword', 'search_moni', 'search_perf',
    'search_poi_recommend', 'search_service_adcode', 'search_word', 'sportsGroupConfig',
    'sportsHealthConfig', 'sportsHomeConfig', 'sportsRouteConfig', 'sportsTaskConfig', 'sports_walk',
    'small_biz_b2b_kb', 'small_biz_case', 'small_biz_fun', 'small_biz_index', 'small_biz_news',
    'splashscreen', 'splashview_config', 'sur_bar', 'taxi_activity', 'testflight_adiu', 'tf_remind',
    'tips_bar_black_list', 'vip'
  ];

  var RULES = [
    {
      id: 'route-plan-before-navi',
      match: function (p) { return p.indexOf('/aos/perception/publicTravel/beforeNavi') >= 0; },
      apply: function (o) {
        var d = o.data || {};
        var cd = d.common_data || {};
        each(['bus_plan_bottom_event', 'bus_plan_bottom_tips', 'bus_plan_segment_event'], function (k) {
          clearArray(cd[k], 'data');
        });
        if (d.front_end) clearArray(d.front_end, 'assistant');
      }
    },
    {
      id: 'taxi-order-content-info',
      match: function (p) { return p.indexOf('/ws/boss/car/order/content_info') >= 0; },
      apply: function (o) {
        var d = o.data || {};
        var luban = d.lubanData || {};
        each(['popup', 'skin'], function (k) { if (luban[k]) clearArray(luban[k], 'dataList'); });
        var matrix = d.matrixData || {};
        each(['c3DiversionCard', 'DiversionCard'], function (k) {
          if (matrix[k]) clearArray(matrix[k], 'dataList');
        });
      }
    },
    {
      id: 'taxi-order-friendly-information',
      match: function (p) { return p.indexOf('/ws/boss/order_web/friendly_information') >= 0; },
      apply: function (o) {
        var slot = o.data && o.data['105'];
        if (!slot) return;
        each(['banners', 'carouselTips', 'integratedBanners', 'integratedTips', 'skins', 'skinAndTips', 'tips'], function (k) {
          drop(slot, k);
        });
      }
    },
    {
      id: 'bus-plan-integrate',
      match: function (p) { return p.indexOf('/ws/bus/plan/integrate') >= 0; },
      apply: function (o) {
        var d = o.data || {};
        if (d.banner_lists) {
          clearArray(d.banner_lists, 'data');
          clearArray(d.banner_lists, 'tips');
        }
        var mixed = d.mixed_plans || {};
        if (mixed.data) clearArray(mixed.data, 'taxiPlans');
      }
    },
    {
      id: 'hotel-page',
      match: function (p) { return p.indexOf('/ws/c3frontend/af-hotel/page/main') >= 0; },
      apply: function (o) {
        var mods = o.data && o.data.modules;
        if (!mods) return;
        each(['CouponPortalCard', 'CouponWidget', 'recommended_list'], function (k) { drop(mods, k); });
        var uf = mods.user_filter_card;
        if (!uf || !uf.data) return;
        if (uf.data.search_button_data) drop(uf.data.search_button_data, 'rightbgText');
        each(['banner', 'bannerList', 'service_data', 'sug_items_data'], function (k) { drop(uf.data, k); });
      }
    },
    {
      id: 'walk-end-page',
      match: function (p) { return p.indexOf('/ws/c3frontend/af-launch/page/main') >= 0; },
      apply: function (o) {
        var mods = o.data && o.data.modules;
        if (mods && mods.C1EndNaviEngine && mods.C1EndNaviEngine.data) mods.C1EndNaviEngine.data = {};
      }
    },
    {
      id: 'nearby-page',
      match: function (p) { return p.indexOf('/ws/c3frontend/af-nearby/nearby') >= 0; },
      apply: function (o) {
        var mods = o.data && o.data.modules;
        if (!mods) return;
        clearObject(mods, 'banner');
        clearObject(mods, 'contentPoster');
      }
    },
    {
      id: 'route-plan-home-card',
      match: function (p) { return p.indexOf('/ws/faas/amap-navigation/card-service-plan-home') >= 0; },
      apply: function (o) {
        var d = o.data;
        if (d && Array.isArray(d.children)) {
          d.children = d.children.filter(function (c) { return !own(c, 'schema'); });
        }
      }
    },
    {
      id: 'home-page',
      match: function (p) { return startsWith(p, '/ws/faas/amap-navigation/main-page') && !startsWith(p, '/ws/faas/amap-navigation/main-page-'); },
      apply: function (o) {
        var d = o.data;
        if (!d) return;
        var keepCards = ['ContinueNavigationCard', 'FrequentLocation', 'LoginCard'];
        if (Array.isArray(d.cardList)) {
          d.cardList = d.cardList.filter(function (c) { return keepCards.indexOf(c && c.dataKey) >= 0; });
        }
        if (Array.isArray(d.mapBizList)) {
          d.mapBizList = d.mapBizList.filter(function (c) { return c && c.dataKey === 'FindCarVirtualCard'; });
        }
      }
    },
    {
      id: 'drive-route-info',
      match: function (p) { return p.indexOf('/ws/perception/drive/routeInfo') >= 0; },
      apply: function (o) {
        var d = o.data || {};
        if (d.tbt && Array.isArray(d.tbt.event)) {
          d.tbt.event = d.tbt.event.filter(function (i) { return !isAdDynamicId(i); });
        }
        var fe = d.front_end;
        if (!fe) return;
        drop(fe, 'assistant');
        if (Array.isArray(fe.guide_tips)) {
          fe.guide_tips = fe.guide_tips.filter(function (i) { return !i || i.biz_type !== 'music'; });
        }
        if (Array.isArray(fe.download)) {
          fe.download = fe.download.filter(function (i) { return !isAdDynamicId(i); });
        }
      }
    },
    {
      id: 'drive-route-plan',
      match: function (p) { return p.indexOf('/ws/perception/drive/routePlan') >= 0; },
      apply: function (o) {
        var d = o.data || {};
        var fe = d.front_end;
        if (fe) each(['assistant', 'global_guide_data', 'route_search', 'start_button_tips'], function (k) { drop(fe, k); });
        if (d.tbt && Array.isArray(d.tbt.event)) {
          d.tbt.event = d.tbt.event.filter(function (i) { return !isAdDynamicId(i); });
        }
        if (fe && Array.isArray(fe.download)) {
          fe.download = fe.download.filter(function (i) { return !isAdDynamicId(i); });
        }
      }
    },
    {
      id: 'taxi-promotion-resource',
      match: function (p) { return p.indexOf('/ws/promotion-web/resource') >= 0; },
      apply: function (o) {
        var d = o.data;
        if (!d) return;
        each(['alpha', 'banner', 'bravo', 'bubble', 'charlie', 'icon', 'other', 'popup', 'push', 'tips'], function (k) {
          drop(d, k);
        });
      }
    },
    {
      id: 'profile-page',
      match: function (p) { return p.indexOf('/ws/shield/dsp/profile/index/nodefaasv3') >= 0; },
      apply: function (o) {
        var d = o.data;
        if (!d) return;
        each(['tipData', 'memberInfo', 'topMixedCard'], function (k) { drop(d, k); });
        if (Array.isArray(d.cardList)) {
          d.cardList = d.cardList.filter(function (c) { return c && c.dataKey === 'MyOrderCard'; });
        }
      }
    },
    {
      id: 'global-layer-switches',
      match: function (p) { return p.indexOf('/ws/shield/frogserver/aocs/updatable/') >= 0; },
      apply: function (o) {
        var d = o.data;
        if (!d) return;
        each(LAYER_SWITCHES, function (k) {
          if (own(d, k)) d[k] = { status: 1, version: '', value: '' };
        });
      }
    },
    {
      id: 'poi-coupon-info',
      match: function (p) { return p.indexOf('/ws/shield/search/common/coupon/info') >= 0; },
      apply: function (o) { if (o.data) o.data = {}; }
    },
    {
      id: 'nearby-recommend-feed',
      match: function (p) { return p.indexOf('/ws/shield/search/nearbyrec_smart') >= 0; },
      apply: function (o) {
        var d = o.data;
        if (!d || !Array.isArray(d.modules)) return;
        var keep = ['head', 'search_hot_words', 'feed_rec'];
        d.modules = d.modules.filter(function (m) { return keep.indexOf(m) >= 0; });
      }
    },
    {
      id: 'poi-detail',
      match: function (p) { return p.indexOf('/ws/shield/search/poi/detail') >= 0; },
      apply: function (o) {
        var d = o.data || {};
        var mods = d.modules;
        if (!mods) return;
        var cr = mods.combineReviews;
        if (cr && cr.data) drop(cr.data, 'write_comment');
        each(POI_DETAIL_MODULES, function (k) { drop(mods, k); });
      }
    },
    {
      id: 'search-hotword',
      match: function (p) { return p.indexOf('/ws/shield/search_bff/hotword') >= 0; },
      apply: function (o) {
        var d = o.data;
        if (d && Array.isArray(d.headerHotWord)) d.headerHotWord = [];
      }
    },
    {
      id: 'search-poi-result',
      match: function (p) {
        return p.indexOf('/ws/shield/search_poi/search/sp') >= 0 || p.indexOf('/ws/shield/search_poi/mps') >= 0;
      },
      apply: function (o) {
        var d = o.data || {};
        if (d.list_data) {
          var list = d.list_data.content && d.list_data.content[0];
          if (!list) return;
          if (list.hookInfo && list.hookInfo.data) {
            drop(list.hookInfo.data, 'header');
            drop(list.hookInfo.data, 'house_info');
          }
          if (list.map_bottom_bar) drop(list.map_bottom_bar, 'hotel');
          if (list.poi && list.poi.item_info && list.poi.item_info.tips_bottombar_button) {
            drop(list.poi.item_info.tips_bottombar_button, 'hotel');
          }
          drop(list, 'tips_operation_info');
          if (list.bottom && list.bottom.bottombar_button) drop(list.bottom.bottombar_button, 'hotel');
          if (list.card) {
            var adCards = ['SearchCardBrand', 'NearbyGroupBuy', 'ImageBanner'];
            if (adCards.indexOf(list.card.card_id) >= 0) delete list.card;
          }
          return;
        }
        if (d.district && Array.isArray(d.district.poi_list) && d.district.poi_list[0]) {
          var poi = d.district.poi_list[0];
          drop(poi, 'transportation');
          drop(poi, 'feed_rec_tab');
          return;
        }
        var mods = d.modules;
        if (!mods) return;
        var nested = mods.not_parse_result && mods.not_parse_result.data && mods.not_parse_result.data.list_data;
        if (nested && nested.content && nested.content[0]) {
          var n = nested.content[0];
          if (n.hookInfo && n.hookInfo.data) {
            drop(n.hookInfo.data, 'header');
            drop(n.hookInfo.data, 'house_info');
          }
          if (n.map_bottom_bar) drop(n.map_bottom_bar, 'hotel');
          if (n.poi && n.poi.item_info && n.poi.item_info.tips_bottombar_button) {
            drop(n.poi.item_info.tips_bottombar_button, 'hotel');
          }
          drop(n, 'tips_operation_info');
          if (n.bottom && n.bottom.bottombar_button) drop(n.bottom.bottombar_button, 'hotel');
        }
        var listData = mods.list_data && mods.list_data.data;
        if (listData && Array.isArray(listData.content)) {
          listData.content = listData.content.filter(function (i) {
            return ['brandAdCard', 'toplist_al'].indexOf(i && i.item_type) < 0;
          });
        }
      }
    },
    {
      id: 'search-suggestion',
      match: function (p) { return p.indexOf('/ws/shield/search_poi/sug') >= 0; },
      apply: function (o) {
        if (Array.isArray(o.tip_list)) {
          o.tip_list = o.tip_list.filter(function (item) { return !isAdSuggestion(item); });
          return;
        }
        if (Array.isArray(o.city_list)) {
          each(o.city_list, function (city) {
            if (city && Array.isArray(city.tip_list)) {
              city.tip_list = city.tip_list.filter(function (item) { return !isAdSuggestion(item); });
            }
          });
        }
      }
    },
    {
      id: 'search-tips-operation',
      match: function (p) { return p.indexOf('/ws/shield/search_poi/tips_operation_location') >= 0; },
      apply: function (o) {
        var d = o.data || {};
        drop(d, 'coupon');
        var mods = d.modules;
        if (!mods) return;
        each(['belt', 'common_float_bar', 'common_image_banner', 'coupon_discount_float_bar', 'coupon_float_bar',
          'discount_coupon', 'image_cover_bar', 'mood_coupon_banner', 'operation_brand',
          'promotion_wrap_card', 'tips_top_banner'], function (k) { drop(mods, k); });
      }
    },
    {
      id: 'splash-screen',
      match: function (p) { return p.indexOf('/ws/valueadded/alimama/splash_screen') >= 0; },
      apply: function (o) {
        var ads = o.data && o.data.ad;
        if (!Array.isArray(ads)) return;
        each(ads, function (ad) {
          if (!ad) return;
          if (ad.set && ad.set.setting) ad.set.setting.display_time = 0;
          var creative = Array.isArray(ad.creative) ? ad.creative[0] : null;
          if (creative) {
            creative.start_time = FAR_FUTURE;
            creative.end_time = FAR_FUTURE + 86399;
          }
        });
      }
    }
  ];

  function startsWith(s, prefix) {
    return s.length >= prefix.length && s.slice(0, prefix.length) === prefix;
  }

  function isAdSuggestion(item) {
    var tip = item && item.tip;
    if (!tip) return false;
    if (tip.datatype_spec === '12') return true;
    if (['ad', 'poi_ad', 'toplist'].indexOf(tip.result_type) >= 0) return true;
    if (['ad', 'exct_query_sug_merge_theme', 'query_sug_merge_theme', 'sp'].indexOf(tip.task_tag) >= 0) return true;
    return false;
  }

  function run() {
    var url = typeof $request !== 'undefined' && $request && $request.url ? String($request.url) : '';
    if (!url) return $done({});
    var parts = parseUrl(url);
    if (!parts) return $done({});
    if (parts.host.slice(-ALLOWED_HOST_SUFFIX.length) !== ALLOWED_HOST_SUFFIX) return $done({});

    var raw = typeof $response !== 'undefined' && $response ? $response.body : null;
    if (!raw || typeof raw !== 'string') return $done({});

    var rule = null;
    for (var i = 0; i < RULES.length; i += 1) {
      if (RULES[i].match(parts.path)) { rule = RULES[i]; break; }
    }
    if (!rule) return $done({});

    var json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      return $done({});
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) return $done({});

    try {
      rule.apply(json);
    } catch (e) {
      return $done({});
    }
    return $done({ body: JSON.stringify(json) });
  }

  run();
})();
