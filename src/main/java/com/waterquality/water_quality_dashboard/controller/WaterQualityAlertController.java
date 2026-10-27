
package com.waterquality.water_quality_dashboard.controller;

import com.waterquality.water_quality_dashboard.model.WaterQualityAlert;
import com.waterquality.water_quality_dashboard.model.WaterReading;
import com.waterquality.water_quality_dashboard.repository.WaterQualityAlertRepository;
import com.waterquality.water_quality_dashboard.service.WaterReadingService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/alerts")
public class WaterQualityAlertController {

    private final WaterQualityAlertRepository alertRepository;
    private final WaterReadingService readingService;

    public WaterQualityAlertController(
            WaterQualityAlertRepository alertRepository,
            WaterReadingService readingService) {
        this.alertRepository = alertRepository;
        this.readingService = readingService;
    }

    @GetMapping
    public List<WaterQualityAlert> getAlerts() {
        return alertRepository.findTop100ByOrderByCreatedAtDesc();
    }

    @PostMapping("/test")
    public List<WaterQualityAlert> testRules(
            @RequestBody WaterReading reading) {
        return readingService.createRuleTestAlerts(reading);
    }
}
