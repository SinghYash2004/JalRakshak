package com.waterquality.water_quality_dashboard.controller;

import com.waterquality.water_quality_dashboard.model.WaterReading;
import com.waterquality.water_quality_dashboard.repository.WaterReadingRepository;
import com.waterquality.water_quality_dashboard.service.WaterReadingService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/readings")
public class WaterReadingController {

    private final WaterReadingRepository repository;
    private final WaterReadingService readingService;

    public WaterReadingController(
            WaterReadingRepository repository,
            WaterReadingService readingService) {
        this.repository = repository;
        this.readingService = readingService;
    }

    @PostMapping
    public WaterReading addReading(@RequestBody WaterReading reading) {
        return readingService.saveReading(reading);
    }

    @GetMapping("/latest")
    public WaterReading getLatestReading() {
        return repository.findTop1ByOrderByRecordedAtDesc()
                .stream()
                .findFirst()
                .orElse(null);
    }

    @GetMapping
    public List<WaterReading> getReadings() {
        return repository.findTop50ByOrderByRecordedAtDesc();
    }
}
