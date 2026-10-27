
package com.waterquality.water_quality_dashboard.controller;

import com.waterquality.water_quality_dashboard.service.WaterQualityMLService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/ml/water-quality")
public class WaterQualityMLController {

    private final WaterQualityMLService mlService;

    public WaterQualityMLController(
            WaterQualityMLService mlService
    ) {
        this.mlService = mlService;
    }

    @PostMapping("/predict")
    public ResponseEntity<PredictionResponse> predict(
            @Valid @RequestBody PredictionRequest request
    ) {
        String prediction = mlService.predict(
                request.pH(),
                request.tds(),
                request.turbidity(),
                request.temperature()
        );

        return ResponseEntity.ok(
                new PredictionResponse(
                        prediction,
                        "Prediction generated successfully"
                )
        );
    }

    public record PredictionRequest(
            @NotNull
            @DecimalMin("0.0")
            @DecimalMax("14.0")
            Double pH,

            @NotNull
            @DecimalMin("0.0")
            Double tds,

            @NotNull
            @DecimalMin("0.0")
            Double turbidity,

            @NotNull
            @DecimalMin("-50.0")
            @DecimalMax("100.0")
            Double temperature
    ) {}

    public record PredictionResponse(
            String prediction,
            String message
    ) {}
}
