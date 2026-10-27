
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
    private final WaterQualityMLService mlService;

    private static final double PH_MIN = 6.5;
    private static final double PH_MAX = 8.5;
    private static final double TURBIDITY_MAX_NTU = 1.0;
    private static final double TDS_MAX_PPM = 500.0;

    public WaterReadingService(
            WaterReadingRepository readingRepository,
            WaterQualityAlertRepository alertRepository,
            WaterQualityMLService mlService) {

        this.readingRepository = readingRepository;
        this.alertRepository = alertRepository;
        this.mlService = mlService;
    }

    @Transactional
    public WaterReading saveReading(WaterReading reading) {

        if (reading == null) {
            throw new IllegalArgumentException(
                    "Reading request body is required.");
        }

        Double ph = reading.getPh();
        Double tds = reading.getTds();
        Double turbidity = reading.getTurbidity();
        Double temperature = reading.getTemperature();

        // Generate ML prediction when all values are valid.
        if (ph != null
                && tds != null
                && turbidity != null
                && temperature != null
                && Double.isFinite(ph)
                && Double.isFinite(tds)
                && Double.isFinite(turbidity)
                && Double.isFinite(temperature)
                && ph >= 0 && ph <= 14
                && tds >= 0
                && turbidity >= 0
                && temperature >= -50
                && temperature <= 100) {

            String prediction = mlService.predict(
                    ph,
                    tds,
                    turbidity,
                    temperature
            );

            reading.setMlPrediction(prediction);

        } else {
            reading.setMlPrediction(null);
        }

        // Save first so every real alert has a reading ID.
        WaterReading saved = readingRepository.save(reading);

        // Rule-based alerts for actual sensor readings.
        createDataQualityAlerts(saved);

        // ML-based alert when the model predicts Unsafe.
        createMlPredictionAlert(saved);

        return saved;
    }

    private void createMlPredictionAlert(WaterReading reading) {

        String prediction = reading.getMlPrediction();

        if (prediction == null
                || !prediction.trim().equalsIgnoreCase("Unsafe")) {
            return;
        }

        WaterQualityAlert alert = new WaterQualityAlert(
                reading.getId(),
                "ML_PREDICTION_UNSAFE",
                "CRITICAL",
                "ML Prediction",
                null,
                "ML MODEL WARNING: The model classified this reading "
                        + "as Unsafe. This is an experimental, "
                        + "dataset-based prediction and is not a "
                        + "drinking-water safety certification. "
                        + "Verify the sensors and obtain appropriate "
                        + "water-quality testing."
        );

        alertRepository.save(alert);
    }

    private void createDataQualityAlerts(WaterReading reading) {

        List<WaterQualityAlert> alerts = new ArrayList<>();

        Double ph = reading.getPh();
        Double turbidity = reading.getTurbidity();
        Double tds = reading.getTds();
        Double temperature = reading.getTemperature();

        // Rule 1: pH outside the configured example range.
        if (ph != null && (ph < PH_MIN || ph > PH_MAX)) {

            alerts.add(new WaterQualityAlert(
                    reading.getId(),
                    "PH_OUT_OF_RANGE",
                    "CRITICAL",
                    "pH",
                    ph,
                    "pH ALERT: Reading is outside the configured "
                            + "example range of 6.5 to 8.5. "
                            + "Verify sensor calibration."
            ));
        }

        // Rule 2: Turbidity above the configured example threshold.
        if (turbidity != null
                && turbidity > TURBIDITY_MAX_NTU) {

            alerts.add(new WaterQualityAlert(
                    reading.getId(),
                    "TURBIDITY_HIGH",
                    "CRITICAL",
                    "Turbidity",
                    turbidity,
                    "TURBIDITY ALERT: Reading exceeds the configured "
                            + "example limit of 1.0 NTU."
            ));
        }

        // Rule 3: TDS above the configured example threshold.
        if (tds != null && tds > TDS_MAX_PPM) {

            alerts.add(new WaterQualityAlert(
                    reading.getId(),
                    "TDS_HIGH",
                    "CRITICAL",
                    "TDS",
                    tds,
                    "TDS ALERT: Reading exceeds the configured "
                            + "example limit of 500 ppm."
            ));
        }

        // Missing sensor values.
        addMissingValueAlert(
                alerts, reading, "pH", ph);

        addMissingValueAlert(
                alerts, reading, "Turbidity", turbidity);

        addMissingValueAlert(
                alerts, reading, "TDS", tds);

        addMissingValueAlert(
                alerts, reading, "Temperature", temperature);

        // Temperature sensor plausibility check.
        if (temperature != null
                && (temperature < -10 || temperature > 85)) {

            alerts.add(new WaterQualityAlert(
                    reading.getId(),
                    "TEMPERATURE_SENSOR_RANGE",
                    "WARNING",
                    "Temperature",
                    temperature,
                    "Temperature is outside the configured sensor "
                            + "plausibility range (-10 to 85 °C). "
                            + "Check the sensor and wiring."
            ));
        }

        if (!alerts.isEmpty()) {
            alertRepository.saveAll(alerts);
        }
    }

    // Existing test endpoint functionality is preserved.
    @Transactional
    public List<WaterQualityAlert> createRuleTestAlerts(
            WaterReading reading) {

        if (reading == null) {
            throw new IllegalArgumentException(
                    "Test reading request body is required.");
        }

        List<WaterQualityAlert> alerts = new ArrayList<>();

        Double ph = reading.getPh();
        Double turbidity = reading.getTurbidity();
        Double tds = reading.getTds();

        if (ph == null) {

            addTestAlert(
                    alerts,
                    "TEST_MISSING_PH",
                    "pH",
                    null,
                    "TEST MODE: pH value is missing."
            );

        } else if (ph < 0 || ph > 14) {

            addTestAlert(
                    alerts,
                    "TEST_PH_INVALID",
                    "pH",
                    ph,
                    "TEST MODE: pH is outside the valid 0-14 scale."
            );

        } else if (ph < PH_MIN || ph > PH_MAX) {

            addTestAlert(
                    alerts,
                    "TEST_PH_OUT_OF_RANGE",
                    "pH",
                    ph,
                    "TEST MODE: pH is outside the example range "
                            + PH_MIN + " to " + PH_MAX + "."
            );
        }

        if (turbidity == null) {

            addTestAlert(
                    alerts,
                    "TEST_MISSING_TURBIDITY",
                    "Turbidity",
                    null,
                    "TEST MODE: turbidity value is missing."
            );

        } else if (turbidity < 0) {

            addTestAlert(
                    alerts,
                    "TEST_TURBIDITY_INVALID",
                    "Turbidity",
                    turbidity,
                    "TEST MODE: turbidity cannot be negative."
            );

        } else if (turbidity > TURBIDITY_MAX_NTU) {

            addTestAlert(
                    alerts,
                    "TEST_TURBIDITY_HIGH",
                    "Turbidity",
                    turbidity,
                    "TEST MODE: turbidity exceeds the example "
                            + "limit of " + TURBIDITY_MAX_NTU + " NTU."
            );
        }

        if (tds == null) {

            addTestAlert(
                    alerts,
                    "TEST_MISSING_TDS",
                    "TDS",
                    null,
                    "TEST MODE: TDS value is missing."
            );

        } else if (tds < 0) {

            addTestAlert(
                    alerts,
                    "TEST_TDS_INVALID",
                    "TDS",
                    tds,
                    "TEST MODE: TDS cannot be negative."
            );

        } else if (tds > TDS_MAX_PPM) {

            addTestAlert(
                    alerts,
                    "TEST_TDS_HIGH",
                    "TDS",
                    tds,
                    "TEST MODE: TDS exceeds the example limit of "
                            + TDS_MAX_PPM + " ppm."
            );
        }

        if (alerts.isEmpty()) {

            alerts.add(new WaterQualityAlert(
                    null,
                    "TEST_RULES_PASSED",
                    "INFO",
                    "Test",
                    null,
                    "TEST MODE: All supplied values passed the "
                            + "configured example rules. This does "
                            + "not certify that water is safe."
            ));
        }

        return alertRepository.saveAll(alerts);
    }

    private void addTestAlert(
            List<WaterQualityAlert> alerts,
            String code,
            String parameter,
            Double value,
            String message) {

        alerts.add(new WaterQualityAlert(
                null,
                code,
                "WARNING",
                parameter,
                value,
                message
        ));
    }

    private void addMissingValueAlert(
            List<WaterQualityAlert> alerts,
            WaterReading reading,
            String parameter,
            Double value) {

        if (value == null) {

            alerts.add(new WaterQualityAlert(
                    reading.getId(),
                    "MISSING_" + parameter.toUpperCase()
                            .replace(" ", "_"),
                    "WARNING",
                    parameter,
                    null,
                    parameter + " reading is missing. "
                            + "Check the request payload or "
                            + "sensor connection."
            ));
        }
    }
}
