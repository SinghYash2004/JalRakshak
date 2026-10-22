package com.waterquality.water_quality_dashboard.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "water_quality_alerts")
public class WaterQualityAlert {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long readingId;

    @Column(nullable = false, length = 80)
    private String code;

    @Column(nullable = false, length = 20)
    private String severity;

    @Column(nullable = false, length = 40)
    private String parameter;

    private Double observedValue;

    @Column(nullable = false, length = 500)
    private String message;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    public WaterQualityAlert() {
    }

    public WaterQualityAlert(
            Long readingId,
            String code,
            String severity,
            String parameter,
            Double observedValue,
            String message) {
        this.readingId = readingId;
        this.code = code;
        this.severity = severity;
        this.parameter = parameter;
        this.observedValue = observedValue;
        this.message = message;
    }

    @PrePersist
    public void setCreatedAtIfMissing() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }

    public Long getId() {
        return id;
    }

    public Long getReadingId() {
        return readingId;
    }

    public String getCode() {
        return code;
    }

    public String getSeverity() {
        return severity;
    }

    public String getParameter() {
        return parameter;
    }

    public Double getObservedValue() {
        return observedValue;
    }

    public String getMessage() {
        return message;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
