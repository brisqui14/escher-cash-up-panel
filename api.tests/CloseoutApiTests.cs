using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using CashUp.React.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CashUp.React.Api.Tests;

public sealed class CloseoutApiTests : IDisposable
{
    private readonly ApiFactory _factory = new();
    private readonly HttpClient _client;

    public CloseoutApiTests() => _client = _factory.CreateClient();

    [Fact]
    public async Task Initial_snapshot_derives_expected_cash_without_inventing_a_count()
    {
        var snapshot = await ReadSnapshot();

        Assert.Equal(17500, snapshot.ExpectedCashMinor);
        Assert.Null(snapshot.CountedCashMinor);
        Assert.Null(snapshot.VarianceMinor);
        Assert.Null(snapshot.FinalizedAtUtc);
        Assert.Equal("draft", snapshot.Status);
    }

    [Theory]
    [InlineData(0, "Drawer is empty.", -17500)]
    [InlineData(17300, "Recounted shortage.", -200)]
    [InlineData(17500, "", 0)]
    [InlineData(17700, "Recounted surplus.", 200)]
    public async Task A_valid_saved_count_can_be_finalized(
        long count, string explanation, long variance)
    {
        var saved = await _client.PutAsJsonAsync(
            "/api/closeout/draft", new { countedCashMinor = count, explanation });
        saved.EnsureSuccessStatusCode();

        var finalized = await _client.PostAsync("/api/closeout/finalize", null);
        finalized.EnsureSuccessStatusCode();
        var snapshot = await finalized.Content.ReadFromJsonAsync<CloseoutSnapshot>();

        Assert.NotNull(snapshot);
        Assert.Equal(count, snapshot.CountedCashMinor);
        Assert.Equal(variance, snapshot.VarianceMinor);
        Assert.Equal(explanation, snapshot.Explanation);
        Assert.Equal("finalized", snapshot.Status);
        Assert.NotNull(snapshot.FinalizedAtUtc);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"countedCashMinor\":-1}")]
    [InlineData("{\"countedCashMinor\":1.5}")]
    [InlineData("{\"countedCashMinor\":\"17300\"}")]
    [InlineData("{\"countedCashMinor\":1e2}")]
    [InlineData("{\"countedCashMinor\":9007199254740992}")]
    [InlineData("{not-json")]
    public async Task Invalid_input_is_a_problem_response_and_preserves_the_previous_draft(
        string body)
    {
        (await _client.PutAsJsonAsync("/api/closeout/draft",
            new { countedCashMinor = 17300, explanation = "Original draft" }))
            .EnsureSuccessStatusCode();
        var before = await _client.GetStringAsync("/api/closeout");

        var response = await _client.PutAsync("/api/closeout/draft",
            new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(before, await _client.GetStringAsync("/api/closeout"));
    }

    [Theory]
    [InlineData(17300, "")]
    [InlineData(17700, " \t ")]
    public async Task A_discrepant_draft_can_be_saved_but_needs_an_explanation_to_finalize(
        long count, string explanation)
    {
        (await _client.PutAsJsonAsync("/api/closeout/draft",
            new { countedCashMinor = count, explanation })).EnsureSuccessStatusCode();
        var before = await _client.GetStringAsync("/api/closeout");

        var response = await _client.PostAsync("/api/closeout/finalize", null);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(problem.GetProperty("errors").TryGetProperty("explanation", out _));
        Assert.Equal(before, await _client.GetStringAsync("/api/closeout"));
    }

    [Fact]
    public async Task Finalizing_without_a_count_does_not_treat_it_as_zero()
    {
        var response = await _client.PostAsync("/api/closeout/finalize", null);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(problem.GetProperty("errors").TryGetProperty("countedCashMinor", out _));
        Assert.Null((await ReadSnapshot()).CountedCashMinor);
    }

    [Fact]
    public async Task Finalization_is_retryable_and_the_record_cannot_be_edited()
    {
        (await _client.PutAsJsonAsync("/api/closeout/draft",
            new { countedCashMinor = 17500 })).EnsureSuccessStatusCode();
        var first = await _client.PostAsync("/api/closeout/finalize", null);
        first.EnsureSuccessStatusCode();
        var original = await first.Content.ReadAsStringAsync();

        var retries = await Task.WhenAll(Enumerable.Range(0, 8)
            .Select(_ => _client.PostAsync("/api/closeout/finalize", null)));
        foreach (var retry in retries)
        {
            Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
            Assert.Equal(original, await retry.Content.ReadAsStringAsync());
            retry.Dispose();
        }
        var edit = await _client.PutAsJsonAsync("/api/closeout/draft",
            new { countedCashMinor = 0, explanation = "Changed after finalization" });

        Assert.Equal(HttpStatusCode.Conflict, edit.StatusCode);
        Assert.Equal(original, await _client.GetStringAsync("/api/closeout"));
    }

    [Fact]
    public async Task A_simulated_failure_happens_before_mutation_and_is_consumed_only_once()
    {
        (await _client.PutAsJsonAsync("/demo/behavior",
            new { delayMilliseconds = 0, failNextMutation = true })).EnsureSuccessStatusCode();
        Assert.Null((await ReadSnapshot()).CountedCashMinor);

        var failed = await _client.PutAsJsonAsync("/api/closeout/draft",
            new { countedCashMinor = 17500 });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, failed.StatusCode);
        Assert.Null((await ReadSnapshot()).CountedCashMinor);
        (await _client.PutAsJsonAsync("/api/closeout/draft",
            new { countedCashMinor = 17500 })).EnsureSuccessStatusCode();
        Assert.Equal(17500, (await ReadSnapshot()).CountedCashMinor);
    }

    [Fact]
    public async Task Reset_clears_the_closeout_and_pending_failure()
    {
        (await _client.PutAsJsonAsync("/api/closeout/draft",
            new { countedCashMinor = 17500 })).EnsureSuccessStatusCode();
        (await _client.PostAsync("/api/closeout/finalize", null)).EnsureSuccessStatusCode();
        (await _client.PutAsJsonAsync("/demo/behavior",
            new { delayMilliseconds = 0, failNextMutation = true })).EnsureSuccessStatusCode();

        (await _client.PostAsync("/demo/reset", null)).EnsureSuccessStatusCode();

        var snapshot = await ReadSnapshot();
        Assert.Equal("draft", snapshot.Status);
        Assert.Null(snapshot.CountedCashMinor);
        Assert.Null(snapshot.FinalizedAtUtc);
        (await _client.PutAsJsonAsync("/api/closeout/draft",
            new { countedCashMinor = 17500 })).EnsureSuccessStatusCode();
    }

    private async Task<CloseoutSnapshot> ReadSnapshot() =>
        await _client.GetFromJsonAsync<CloseoutSnapshot>("/api/closeout")
        ?? throw new InvalidOperationException("The API returned no snapshot.");

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }
}

internal sealed class ApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.UseContentRoot(Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory, "..", "..", "..", "..", "api")));
}
