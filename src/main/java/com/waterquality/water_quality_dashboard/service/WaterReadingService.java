package com.waterquality.water_quality_dashboard.service;

import com.waterquality.water_quality_dashboard.model.WaterQualityAlert;
import com.waterquality.water_quality_dashboard.model.WaterReading;
import com.waterquality.water_quality_dashboard.repository.WaterQualityAlertRepository;
import com.waterquality.water_quality_dashboard.repository.WaterReadingRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
public class WaterReadingService {

    private final WaterReadingRepository readingRepository;
    private final WaterQualityAlertRepository alertRepository;

    public WaterReadingService(
            WaterReadingRepository readingRepository,
            WaterQualityAlertRepository alertRepository) {
        this.readingRepository = readingRepository;
        this.alertRepository = alertRepository;
    }

    @Transactional
    public WaterReading saveReading(WaterReading reading) {
        if (reading == null) {
            throw new IllegalArgumentException("Reading request body is required.");
        }

        WaterReading saved = readingRepository.save(reading);
        createDataQualityAlerts(saved);
        return saved;
    }

    private void createDataQualityAlerts(WaterReading reading) {
        List<WaterQualityAlert> alerts = new ArrayList<>();

        addMissingValueAlert(alerts, reading, "pH", reading.getPh());
        addMissingValueAlert(alerts, reading, "Turbidity", reading.getTurbidity());
        addMissingValueAlert(alerts, reading, "TDS", reading.getTds());
        addMissingValueAlert(alerts, reading, "Temperature", reading.getTemperature());

        Double temperature = reading.getTemperature();
        if (temperature != null && (temperature < -10 || temperature > 85)) {
            alerts.add(new WaterQualityAlert(
                    reading.getId(),
                    "TEMPERATURE_SENSOR_RANGE",
                    "WARNING",
                    "Temperature",
                    temperature,
                    "Temperature is outside the configured sensor plausibility range (-10 to 85 °C). Check the sensor and wiring."
            ));
        }

        if (!alerts.isEmpty()) {
            alertRepository.saveAll(alerts);
        }
    }

    private void addMissingValueAlert(
            List<WaterQualityAlert> alerts,
            WaterReading reading,
            String parameter,
            Double value) {
        if (value == null) {
            alerts.add(new WaterQualityAlert(
                    reading.getId(),
                    "MISSING_" + parameter.toUpperCase().replace(" ", "_"),
                    "WARNING",
                    parameter,
                    null,
                    parameter + " reading is missing. Check the request payload or sensor connection."
            ));
        }
    }
}
