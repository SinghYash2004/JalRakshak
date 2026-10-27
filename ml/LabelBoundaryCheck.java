
import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class LabelBoundaryCheck {

    public static void main(String[] args) throws IOException {
        Path path = args.length > 0
                ? Path.of(args[0])
                : Path.of("water_quality_dataset1.csv");

        List<String[]> rows = new ArrayList<>();

        try (BufferedReader br = Files.newBufferedReader(path)) {
            String line;
            String[] headers = br.readLine().replace("\uFEFF", "").split(",");

            while ((line = br.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }

                rows.add(line.split(",", -1));
            }

            int ph = indexOf(headers, "pH");
            int tds = indexOf(headers, "TDS_ppm");
            int turbidity = indexOf(headers, "Turbidity_NTU");
            int temperature = indexOf(headers, "Temperature_C");
            int label = indexOf(headers, "Label");

            if (ph < 0 || tds < 0 || turbidity < 0
                    || temperature < 0 || label < 0) {
                System.out.println("Required columns not found.");
                return;
            }

            int boundary = -1;

            for (int i = 1; i < rows.size(); i++) {
                if (!rows.get(i - 1)[label]
                        .equalsIgnoreCase(rows.get(i)[label])) {
                    boundary = i;
                    break;
                }
            }

            if (boundary == -1) {
                System.out.println("No label boundary found.");
                return;
            }

            System.out.println("First row after label transition: "
                    + (boundary + 1));
            System.out.println("\nNearby records:");

            int start = Math.max(0, boundary - 5);
            int end = Math.min(rows.size(), boundary + 5);

            System.out.println(
                    "Row | pH | TDS | Turbidity | Temperature | Label"
            );

            for (int i = start; i < end; i++) {
                String[] r = rows.get(i);

                System.out.printf(
                        "%d | %s | %s | %s | %s | %s%n",
                        i + 1, r[ph], r[tds], r[turbidity],
                        r[temperature], r[label]
                );
            }
        }
    }

    private static int indexOf(String[] headers, String name) {
        for (int i = 0; i < headers.length; i++) {
            if (headers[i].trim().equalsIgnoreCase(name)) {
                return i;
            }
        }
        return -1;
    }
}
