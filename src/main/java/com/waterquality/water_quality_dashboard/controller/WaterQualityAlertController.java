
package com.waterquality.water_quality_dashboard.controller;

import com.waterquality.water_quality_dashboard.model.WaterQualityAlert;
import com.waterquality.water_quality_dashboard.repository.WaterQualityAlertRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/alerts")
public class WaterQualityAlertController {

    private final WaterQualityAlertRepository alertRepository;

    public WaterQualityAlertController(
            WaterQualityAlertRepository alertRepository) {
        this.alertRepository = alertRepository;
    }

    @GetMapping
    public List<WaterQualityAlert> getAlerts() {
        return alertRepository.findAll();
    }
}
