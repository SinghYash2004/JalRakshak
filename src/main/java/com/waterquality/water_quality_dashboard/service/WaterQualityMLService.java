
package com.waterquality.water_quality_dashboard.service;

import org.springframework.stereotype.Service;
import org.tribuo.Example;
import org.tribuo.Model;
import org.tribuo.Prediction;
import org.tribuo.classification.Label;
import org.tribuo.impl.ArrayExample;

import java.nio.file.Files;
import java.nio.file.Path;

@Service
public class WaterQualityMLService {

    private final Model<Label> model;

    @SuppressWarnings("unchecked")
    public WaterQualityMLService() {
        Path modelPath = Path.of(
                "src",
                "main",
                "resources",
                "models",
                "water-quality-tree.tribuo"
        );

        try {
            if (!Files.isRegularFile(modelPath)) {
                throw new IllegalStateException(
                        "ML model not found: "
                                + modelPath.toAbsolutePath()
                );
            }

            Model<?> loadedModel =
                    Model.deserializeFromFile(modelPath);

            this.model = (Model<Label>) loadedModel;

            System.out.println(
                    "Water Quality ML model loaded successfully."
            );

        } catch (Exception e) {
            throw new IllegalStateException(
                    "Failed to load Water Quality ML model.",
                    e
            );
        }
    }

    public String predict(
            double pH,
            double tds,
            double turbidity,
            double temperature
    ) {
        if (!Double.isFinite(pH)
                || !Double.isFinite(tds)
                || !Double.isFinite(turbidity)
                || !Double.isFinite(temperature)) {
            throw new IllegalArgumentException(
                    "All readings must be finite numbers."
            );
        }

        String[] featureNames = {
                "pH",
                "TDS_ppm",
                "Turbidity_NTU",
                "Temperature_C"
        };

        double[] featureValues = {
                pH,
                tds,
                turbidity,
                temperature
        };

        Example<Label> example = new ArrayExample<>(
                new Label("Unknown"),
                featureNames,
                featureValues
        );

        Prediction<Label> prediction = model.predict(example);

        return prediction.getOutput().getLabel();
    }
}
