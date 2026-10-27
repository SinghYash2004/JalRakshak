import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

public class DatasetInspector {

    private static final String[] FEATURES = {
            "pH",
            "TDS_ppm",
            "Turbidity_NTU",
            "Temperature_C"
    };

    public static void main(String[] args) {
        Path file = args.length > 0
                ? Path.of(args[0])
                : Path.of("water_quality_dataset1.csv");

        try {
            inspect(file);
        } catch (IOException e) {
            System.err.println("Could not read CSV: " + e.getMessage());
            System.err.println("Check the file path and try again.");
        }
    }

    private static void inspect(Path file) throws IOException {
        if (!Files.isRegularFile(file)) {
            System.err.println("CSV file not found: " + file.toAbsolutePath());
            return;
        }

        List<String[]> rows = new ArrayList<>();

        try (BufferedReader reader = Files.newBufferedReader(
                file, StandardCharsets.UTF_8)) {

            String line;
            String[] headers = null;
            int lineNumber = 0;

            while ((line = reader.readLine()) != null) {
                lineNumber++;

                if (lineNumber == 1) {
                    line = line.replace("\uFEFF", "");
                }

                if (line.isBlank()) {
                    continue;
                }

                List<String> fields = parseCsvLine(line);
                String[] values = fields.toArray(new String[0]);

                if (headers == null) {
                    headers = values;
                    continue;
                }

                if (values.length != headers.length) {
                    System.out.printf(
                            "Warning: line %d has %d fields; expected %d.%n",
                            lineNumber, values.length, headers.length
                    );
                    continue;
                }

                rows.add(values);
            }

            if (headers == null) {
                System.out.println("CSV file is empty.");
                return;
            }

            analyze(headers, rows);
        }
    }

    private static void analyze(String[] headers, List<String[]> rows) {
        Map<String, Integer> columnIndex = new HashMap<>();

        for (int i = 0; i < headers.length; i++) {
            headers[i] = headers[i].trim();
            columnIndex.put(headers[i].toLowerCase(Locale.ROOT), i);
        }

        System.out.println("\n========== DATASET INSPECTION ==========");
        System.out.println("Columns: " + headers.length);
        System.out.println("Valid data rows: " + rows.size());

        System.out.println("\nColumn names:");
        for (String header : headers) {
            System.out.println("- " + header);
        }

        System.out.println("\nMissing values:");
        for (int col = 0; col < headers.length; col++) {
            int missing = 0;

            for (String[] row : rows) {
                if (row[col].isBlank()
                        || row[col].trim().equalsIgnoreCase("null")
                        || row[col].trim().equalsIgnoreCase("NA")) {
                    missing++;
                }
            }

            System.out.printf("%s: %d%n", headers[col], missing);
        }

        Set<String> uniqueRows = new HashSet<>();
        int duplicateRows = 0;

        for (String[] row : rows) {
            if (!uniqueRows.add(String.join("\u001F", row))) {
                duplicateRows++;
            }
        }

        System.out.println("\nDuplicate rows: " + duplicateRows);

        Integer labelIndex = columnIndex.get("label");

        if (labelIndex == null) {
            System.out.println(
                    "\nLabel column not found. Check the actual CSV headers."
            );
        } else {
            Map<String, Integer> labelCounts = new TreeMap<>(
                    String.CASE_INSENSITIVE_ORDER
            );

            String previousLabel = null;
            int labelTransitions = 0;

            System.out.println("\nFirst 20 labels in row order:");

            for (int i = 0; i < rows.size(); i++) {
                String label = rows.get(i)[labelIndex].trim();

                if (label.isEmpty()) {
                    label = "<MISSING>";
                }

                labelCounts.merge(label, 1, Integer::sum);

                if (i < 20) {
                    System.out.printf("Row %d: %s%n", i + 1, label);
                }

                if (previousLabel != null
                        && !previousLabel.equalsIgnoreCase(label)) {
                    labelTransitions++;
                }

                previousLabel = label;
            }

            System.out.println("\nLabel distribution:");

            for (Map.Entry<String, Integer> entry
                    : labelCounts.entrySet()) {
                double percentage = rows.isEmpty() ? 0.0
                        : entry.getValue() * 100.0 / rows.size();

                System.out.printf(
                        "%s: %d (%.2f%%)%n",
                        entry.getKey(),
                        entry.getValue(),
                        percentage
                );
            }

            System.out.println(
                    "\nLabel transitions between adjacent rows: "
                            + labelTransitions
            );
        }

        System.out.println("\nNumeric feature ranges:");

        for (String feature : FEATURES) {
            Integer index = columnIndex.get(
                    feature.toLowerCase(Locale.ROOT)
            );

            if (index == null) {
                System.out.println(feature + ": column not found");
                continue;
            }

            double min = Double.POSITIVE_INFINITY;
            double max = Double.NEGATIVE_INFINITY;
            int valid = 0;
            int invalid = 0;

            for (String[] row : rows) {
                String value = row[index].trim();

                if (value.isEmpty()
                        || value.equalsIgnoreCase("null")
                        || value.equalsIgnoreCase("NA")) {
                    invalid++;
                    continue;
                }

                try {
                    double number = Double.parseDouble(value);

                    if (!Double.isFinite(number)) {
                        invalid++;
                        continue;
                    }

                    min = Math.min(min, number);
                    max = Math.max(max, number);
                    valid++;
                } catch (NumberFormatException e) {
                    invalid++;
                }
            }

            if (valid == 0) {
                System.out.println(feature + ": no valid numeric values");
            } else {
                System.out.printf(
                        Locale.ROOT,
                        "%s: min=%.4f, max=%.4f, valid=%d, invalid=%d%n",
                        feature, min, max, valid, invalid
                );
            }
        }

        System.out.println("\n========== INSPECTION COMPLETE ==========");
    }

    private static List<String> parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean insideQuotes = false;

        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);

            if (c == '"') {
                if (insideQuotes
                        && i + 1 < line.length()
                        && line.charAt(i + 1) == '"') {
                    field.append('"');
                    i++;
                } else {
                    insideQuotes = !insideQuotes;
                }
            } else if (c == ',' && !insideQuotes) {
                fields.add(field.toString().trim());
                field.setLength(0);
            } else {
                field.append(c);
            }
        }

        fields.add(field.toString().trim());
        return fields;
    }
}
