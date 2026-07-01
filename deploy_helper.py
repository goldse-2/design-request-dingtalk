import time
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout, Error as PWError

CF_URL = (
    "https://dash.cloudflare.com/280663af8c119c9954579ca48fa4782d"
    "/pages/new/provider/github"
)
REPO = "design-request-dingtalk"


def safe_query(page, sel):
    try:
        return page.query_selector(sel)
    except PWError:
        return None


def wait_selector(page, sel, timeout=60):
    try:
        page.wait_for_selector(sel, timeout=timeout * 1000)
        return True
    except (PWTimeout, PWError):
        return False


def wait_for_cloudflare(page, max_sec=300):
    """Poll until we're back on dash.cloudflare.com."""
    for _ in range(max_sec * 2):
        try:
            if "dash.cloudflare.com" in page.url:
                return True
        except PWError:
            pass
        time.sleep(0.5)
    return False


def wait_for_not_github(page, max_sec=300):
    """Poll until we leave github.com."""
    for _ in range(max_sec * 2):
        try:
            if "github.com" not in page.url:
                return True
        except PWError:
            pass
        time.sleep(0.5)
    return False


with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=150)
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    # ── 1. Open Cloudflare Pages ──────────────────────────────────────
    print("\n>>> 打开 Cloudflare Pages 部署页面...")
    try:
        page.goto(CF_URL, wait_until="domcontentloaded", timeout=45000)
    except PWError:
        pass
    time.sleep(3)

    # ── 2. Cloudflare login if needed ────────────────────────────────
    if "login" in page.url:
        print(">>> 需要登录 Cloudflare，点击 GitHub 登录...")
        try:
            page.wait_for_selector("button:has-text('Continue with GitHub')", timeout=10000)
            page.click("button:has-text('Continue with GitHub')")
        except (PWTimeout, PWError):
            pass
        time.sleep(3)

    # ── 3. GitHub sudo / human-verification ──────────────────────────
    if "github.com" in page.url:
        print("\n" + "=" * 55)
        print(">>> 浏览器窗口已弹出，请完成：")
        print("    1. 输入 GitHub 密码（如有）")
        print("    2. 完成人机验证（如有）")
        print("    3. 点击 Confirm 或 Install & Authorize")
        print("=" * 55)
        print(">>> 等待你完成，完成后脚本自动继续（最多等 5 分钟）...")
        wait_for_cloudflare(page, max_sec=300)
        print(">>> 已跳回 Cloudflare，继续...")
        time.sleep(3)

    # ── 4. Handle Install & Authorize if shown ───────────────────────
    if "installations/new" in page.url:
        try:
            page.wait_for_selector("button:has-text('Install & Authorize')", timeout=8000)
            btn = page.query_selector("button:has-text('Install & Authorize')")
            if btn and btn.is_enabled():
                print(">>> 点击 Install & Authorize...")
                btn.click()
                print(">>> 等待授权完成...")
                wait_for_cloudflare(page, max_sec=300)
                time.sleep(3)
        except (PWTimeout, PWError):
            pass

    # ── 5. Navigate to provider page if needed ───────────────────────
    if "pages/new/provider/github" not in page.url:
        print(">>> 导航到仓库选择页面...")
        try:
            page.goto(CF_URL, wait_until="domcontentloaded", timeout=30000)
        except PWError:
            pass
        time.sleep(3)

    # ── 6. Connect GitHub if button still present ────────────────────
    try:
        page.wait_for_selector("button:has-text('Connect GitHub')", timeout=8000)
        has_connect = True
    except (PWTimeout, PWError):
        has_connect = False

    if has_connect:
        print(">>> 点击 Connect GitHub...")
        try:
            page.click("button:has-text('Connect GitHub')")
        except PWError:
            pass
        time.sleep(3)

        # May redirect to GitHub again for sudo / install
        if "github.com" in page.url:
            print(">>> 再次出现 GitHub 验证页，请在浏览器中完成后等待自动跳转...")
            # Handle Install & Authorize that may appear without sudo this time
            try:
                page.wait_for_selector("button:has-text('Install & Authorize')", timeout=10000)
                btn = page.query_selector("button:has-text('Install & Authorize')")
                if btn and btn.is_enabled():
                    btn.click()
            except (PWTimeout, PWError):
                pass
            wait_for_cloudflare(page, max_sec=300)
            time.sleep(3)

    # ── 7. Wait for repo list ─────────────────────────────────────────
    print(f">>> 等待仓库列表加载（查找 {REPO}）...")
    found = wait_selector(page, f"text={REPO}", timeout=30)

    if not found:
        search = (
            safe_query(page, "input[placeholder*='earch']") or
            safe_query(page, "input[type='search']")
        )
        if search:
            search.fill(REPO)
            time.sleep(2)
        found = wait_selector(page, f"text={REPO}", timeout=10)

    if found:
        print(">>> 找到仓库，点击选择...")
        try:
            page.click(f"text={REPO}")
        except PWError:
            pass
        time.sleep(2)
    else:
        print(f"!!! 未自动找到仓库 {REPO}，请手动在浏览器中选择，选完后按 Enter")
        input()

    # Begin setup
    begin = safe_query(page, "button:has-text('Begin setup')")
    if begin:
        print(">>> 点击 Begin setup...")
        try:
            begin.click()
        except PWError:
            pass
        time.sleep(3)

    # ── 8. Build settings ────────────────────────────────────────────
    print(">>> 等待构建配置页...")
    wait_selector(page, "button:has-text('Save and Deploy')", timeout=20)

    for sel in [
        "input[id*='build_command']",
        "input[name*='build_command']",
        "input[placeholder*='build command']",
        "input[placeholder*='Build command']",
    ]:
        el = safe_query(page, sel)
        if el:
            try:
                el.triple_click()
                el.fill("")
            except PWError:
                pass
            break

    deploy = safe_query(page, "button:has-text('Save and Deploy')")
    if deploy:
        print(">>> 点击 Save and Deploy，开始部署！")
        try:
            deploy.click()
        except PWError:
            pass
    else:
        print("!!! 未找到 Save and Deploy，请手动点击后按 Enter")
        input()

    # ── 9. Wait for deployment ───────────────────────────────────────
    print(">>> 等待部署完成（最多 5 分钟）...")
    deployed = False
    for i in range(300):
        try:
            html = page.content()
            if any(x in html for x in ["Success", "Deployed", "deployment-status-success", "Visit site"]):
                deployed = True
                break
        except PWError:
            pass
        if i % 15 == 0:
            print(f"  ...已等待 {i} 秒")
        time.sleep(1)

    if deployed:
        print("\n" + "=" * 55)
        print(">>> 部署成功！")
        print(f">>> 访问地址: https://{REPO}.pages.dev")
        print("=" * 55)
    else:
        print(">>> 未自动检测到成功状态，请查看浏览器页面确认。")

    print("\n>>> 浏览器保持打开，查看完毕后按 Enter 关闭。")
    input()
    browser.close()
