
package com.waterquality.water_quality_dashboard.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "water_readings")
public class WaterReading {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Double ph;
    private Double turbidity;
    private Double tds;
    private Double temperature;

    @Column(name = "ml_prediction", length = 20)
    private String mlPrediction;

    private LocalDateTime recordedAt;

    @PrePersist
    public void setTimestamp() {
        if (recordedAt == null) {
            recordedAt = LocalDateTime.now();
        }
    }

    public WaterReading() {}

    public Long getId() {
        return id;
    }

    public Double getPh() {
        return ph;
    }

    public void setPh(Double ph) {
        this.ph = ph;
    }

    public Double getTurbidity() {
        return turbidity;
    }

    public void setTurbidity(Double turbidity) {
        this.turbidity = turbidity;
    }

    public Double getTds() {
        return tds;
    }

    public void setTds(Double tds) {
        this.tds = tds;
    }

    public Double getTemperature() {
        return temperature;
    }

    public void setTemperature(Double temperature) {
        this.temperature = temperature;
    }

    public String getMlPrediction() {
        return mlPrediction;
    }

    public void setMlPrediction(String mlPrediction) {
        this.mlPrediction = mlPrediction;
    }

    public LocalDateTime getRecordedAt() {
        return recordedAt;
    }
}
