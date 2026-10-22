package com.waterquality.water_quality_dashboard.repository;

import com.waterquality.water_quality_dashboard.model.WaterQualityAlert;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WaterQualityAlertRepository
        extends JpaRepository<WaterQualityAlert, Long> {

    List<WaterQualityAlert> findTop100ByOrderByCreatedAtDesc();
}
