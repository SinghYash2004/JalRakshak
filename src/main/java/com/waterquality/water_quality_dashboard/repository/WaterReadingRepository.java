package com.waterquality.water_quality_dashboard.repository;

import com.waterquality.water_quality_dashboard.model.WaterReading;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface WaterReadingRepository
        extends JpaRepository<WaterReading, Long> {

    List<WaterReading> findTop50ByOrderByRecordedAtDesc();

    List<WaterReading> findTop1ByOrderByRecordedAtDesc();
}
