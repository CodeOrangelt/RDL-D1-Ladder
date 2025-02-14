<?php
include 'db.php';

$sql = "SELECT * FROM players ORDER BY points DESC";
$result = $conn->query($sql);

echo "<table>";
echo "<tr><th>Rank</th><th>Username</th><th>Points</th></tr>";

$rank = 1;
while ($row = $result->fetch_assoc()) {
    echo "<tr><td>" . $rank . "</td><td>" . $row['username'] . "</td><td>" . $row['points'] . "</td></tr>";
    $rank++;
}

echo "</table>";

$conn->close();
?>